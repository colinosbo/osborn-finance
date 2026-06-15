// Subscription / recurring-charge detection. Finds merchants charged on a
// regular cadence for a consistent amount, decides which are still ACTIVE, and
// computes monthly/annual cost. Pure function over the user's transactions.
import type { Tx } from './store.js';

// A detected change in a subscription's per-charge price (a "bill increase" or
// the rarer decrease). previousAmount/currentAmount are positive dollar figures.
export interface PriceChange {
  previousAmount: number;  // typical charge before the change
  currentAmount: number;   // most recent charge amount
  deltaAmount: number;     // currentAmount - previousAmount (signed)
  pct: number;             // percent change, rounded (e.g. 60 for +60%)
  direction: 'up' | 'down';
  since: string;           // date of the first charge at the new amount
  annualImpact: number;    // deltaAmount projected over a year at this cadence (signed)
}

export interface Recurring {
  merchant: string; category: string;
  amount: number;          // typical per-charge amount (positive)
  cadence: string;         // Weekly | Biweekly | Monthly | Quarterly | Yearly
  periodDays: number;
  monthlyCost: number; annualCost: number;
  lastCharged: string; nextCharge: string;
  count: number; active: boolean; confidence: number; // 0..1
  priceChange?: PriceChange; // present when the charge amount has stepped up/down
}

const DAY = 864e5;
const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const shift = (iso: string, d: number) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

function cadenceFor(days: number): { label: string; period: number } | null {
  if (days >= 5 && days <= 9) return { label: 'Weekly', period: 7 };
  if (days >= 12 && days <= 16) return { label: 'Biweekly', period: 14 };
  if (days >= 26 && days <= 35) return { label: 'Monthly', period: 30.44 };
  if (days >= 80 && days <= 100) return { label: 'Quarterly', period: 91 };
  if (days >= 330 && days <= 400) return { label: 'Yearly', period: 365 };
  return null;
}

// Categories that are inherently variable consumer spending, never subscriptions,
// no matter how often they repeat (groceries every week is not a subscription).
const NON_SUB = new Set([
  'Dining & Fast Food', 'Gas & Convenience', 'Groceries & Household', 'Shopping',
  'Bars & Nightlife', 'Cash Withdrawals', 'Vape & Tobacco', 'Personal Care',
  'Auto', 'Fees', 'Taxes', 'Income & Refunds'
]);

export function detectRecurring(tx: Tx[]) {
  const anchor = tx.length ? tx[tx.length - 1].date : new Date().toISOString().slice(0, 10);
  const groups: Record<string, Tx[]> = {};
  for (const t of tx) if (t.amount < 0) { const k = t.merchant || t.name; (groups[k] ||= []).push(t); }

  const subs: Recurring[] = [];
  for (const [merchant, allRaw] of Object.entries(groups)) {
    if (allRaw.length < 3) continue;                       // need a real repeating history (3+)
    const all = [...allRaw].sort((a, b) => (a.date < b.date ? -1 : 1));
    // Skip inherently-variable consumer categories outright (the user's complaint:
    // Domino's, Dollar General, gas stations, etc. should never be subscriptions).
    if (NON_SUB.has(all[0].category)) continue;
    const isSubCat = all[0].category === 'Subscriptions & Digital';
    // A subscription charges the SAME amount each time. Keep only the charges at the
    // dominant amount within a TIGHT tolerance (~2% or 50c), and require at least 3.
    const med = median(all.map(t => Math.abs(t.amount)));
    if (med <= 0) continue;
    const tol = Math.max(med * 0.02, 0.5);
    const charges = all.filter(t => Math.abs(Math.abs(t.amount) - med) <= tol);
    if (charges.length < 3) continue;                      // 3+ identical-amount charges
    // Cadence: gaps between same-amount charges must map to a known billing period.
    const gaps: number[] = [];
    for (let i = 1; i < charges.length; i++) gaps.push((Date.parse(charges[i].date) - Date.parse(charges[i - 1].date)) / DAY);
    const medGap = median(gaps);
    const cad = cadenceFor(medGap);
    if (!cad) continue;                                    // must be weekly/monthly/etc, no fuzzy fallback
    const period = cad.period;
    const label = cad.label;
    // Regularity: the gaps must sit tightly around the cadence (real bills are punctual).
    const spread = gaps.length ? median(gaps.map(g => Math.abs(g - medGap))) / Math.max(1, medGap) : 1;
    if (spread > 0.4) continue;                            // too irregular to be a real subscription

    // ---- price-change detection (bill-increase alerts) ----
    // Walk the FULL chronological series back from the newest charge, grouping
    // the trailing run of charges that sit at the same price (the "current"
    // price). Whatever comes before is the "previous" price. A sustained step
    // between the two is a bill increase (or, less commonly, a decrease). The
    // median-cluster `charges` above can't see this — a hike pushes the new
    // charge outside the tolerance band — so we use the raw series here.
    const seriesAmts = all.map(t => Math.abs(t.amount));
    const recentAmt = seriesAmts[seriesAmts.length - 1];
    const recentTol = Math.max(recentAmt * 0.12, 1);
    let j = seriesAmts.length - 1; const recentCluster: number[] = [];
    while (j >= 0 && Math.abs(seriesAmts[j] - recentAmt) <= recentTol) { recentCluster.unshift(seriesAmts[j]); j--; }
    const earlierAmts = seriesAmts.slice(0, j + 1);
    const currentAmount = r2(median(recentCluster));
    const previousAmount = earlierAmts.length ? r2(median(earlierAmts)) : currentAmount;
    const delta = r2(currentAmount - previousAmount);
    const pctChange = previousAmount > 0 ? delta / previousAmount : 0;
    // Thresholds: subscriptions flag earlier (true digital plans rarely drift);
    // everything else needs a bigger, clearly-intentional jump to avoid flagging
    // naturally-variable bills like utilities.
    const minPct = isSubCat ? 0.05 : 0.10;
    const minAbs = isSubCat ? 0.5 : 1.5;
    let priceChange: PriceChange | undefined;
    let amount = r2(median(charges.map(t => Math.abs(t.amount))));
    let lastCharged = charges[charges.length - 1].date;
    if (earlierAmts.length >= 2 && recentCluster.length >= 1 && previousAmount > 0
        && Math.abs(delta) >= minAbs && Math.abs(pctChange) > minPct) {
      priceChange = {
        previousAmount, currentAmount, deltaAmount: delta,
        pct: Math.round(pctChange * 100),
        direction: delta >= 0 ? 'up' : 'down',
        since: all[j + 1].date,
        annualImpact: r2(delta * 365 / period)
      };
      // Reflect what the user pays NOW so totals and the next-charge estimate are current.
      amount = currentAmount;
      lastCharged = all[all.length - 1].date;
    }

    const sinceLast = (Date.parse(anchor) - Date.parse(lastCharged)) / DAY;
    const active = sinceLast <= period * 1.5 + 3;
    const confidence = Math.min(1, (charges.length >= 4 ? 0.6 : charges.length === 3 ? 0.45 : 0.3) + (spread < 0.2 ? 0.3 : spread < 0.4 ? 0.15 : 0) + (isSubCat ? 0.1 : 0));
    subs.push({
      merchant, category: charges[0].category, amount, cadence: label, periodDays: Math.round(period),
      monthlyCost: r2(amount * 30.44 / period), annualCost: r2(amount * 365 / period),
      lastCharged, nextCharge: shift(lastCharged, Math.round(period)),
      count: charges.length, active, confidence: r2(confidence),
      ...(priceChange ? { priceChange } : {})
    });
  }

  subs.sort((a, b) => (a.active === b.active ? b.monthlyCost - a.monthlyCost : a.active ? -1 : 1));
  const activeSubs = subs.filter(s => s.active);
  // Bill-increase alerts: active subscriptions whose price has stepped up.
  const increases = activeSubs.filter(s => s.priceChange && s.priceChange.direction === 'up');
  return {
    subscriptions: subs,
    totals: {
      activeCount: activeSubs.length,
      monthlyTotal: r2(activeSubs.reduce((s, x) => s + x.monthlyCost, 0)),
      annualTotal: r2(activeSubs.reduce((s, x) => s + x.annualCost, 0))
    },
    alerts: {
      increaseCount: increases.length,
      monthlyImpact: r2(increases.reduce((s, x) => s + x.priceChange!.deltaAmount * 30.44 / x.periodDays, 0)),
      annualImpact: r2(increases.reduce((s, x) => s + x.priceChange!.annualImpact, 0))
    }
  };
}

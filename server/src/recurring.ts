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

// A subscription is identified DYNAMICALLY by behavior — a consistent amount charged
// on a regular, still-active cadence — NOT by a hardcoded list of vendors or a narrow
// category allowlist. That keeps detection working across any dataset and still finds
// a real subscription the bank miscategorized (e.g. an Apple bill that lands in
// "Other"). The only categories we rule out are the ones that are structurally never
// subscriptions: moving your own money (debt, card payments, transfers, savings),
// income, taxes, cash withdrawals, and bank fees. Everything else has to earn its
// place purely on the recurring-signal tests below (tight amount tolerance + punctual
// known cadence + 3+ charges), which is what filters out variable dining/shopping or
// a few same-price flights.
const NON_SUBSCRIPTION_CATS = new Set([
  // Moving your own money / income / taxes / legal obligations — not a subscription.
  'Loan Payments', 'Credit Card Payments', 'Savings & Investments', 'P2P & Transfers',
  'Income & Refunds', 'Taxes', 'Cash Withdrawals', 'Fees', 'Legal & Court',
  // Consumption of goods, where several similar-priced visits are coincidence, not a
  // recurring plan (e.g. four ~$19 lunches). Real subscriptions don't live here.
  'Dining & Fast Food', 'Gas & Convenience', 'Groceries & Household', 'Shopping', 'Bars & Nightlife'
]);

// Tokens that are billing / geographic / descriptor noise rather than a brand, used
// to reduce a messy bank descriptor down to the words that actually identify the
// company (so "ADOBE CC", "ADOBE SYSTEMS INC" and "ADOBE CREATIVE CLOUD" all reduce
// to just ADOBE).
// Words that are billing / geographic / generic product descriptors rather than a
// brand. We strip these so a descriptor reduces to the word(s) that identify the
// company. NOTE: only the COMMON, collision-prone product words are listed (PLUS, APP,
// BUNDLE, …) — these recur across unrelated vendors ("DISNEY PLUS", "DROPBOX PLUS") so
// matching on them would wrongly merge. Less common tier words (e.g. PERSONAL) are
// deliberately kept, since they're the only thing linking abbreviation variants like
// "MICROSOFT 365 PERSONAL" and "MSFT*365 PERSONAL".
const BRAND_STOP = new Set([
  'COM', 'INC', 'LLC', 'LTD', 'THE', 'AND', 'FOR', 'USA', 'BILL', 'BILLING', 'STREAMING',
  'SYSTEMS', 'CREATIVE', 'CLOUD', 'PREMIUM', 'PREM', 'PLUS', 'APP', 'BUNDLE', 'DIGITAL',
  'ACCESS', 'PLAN', 'STORAGE', 'RENEWAL', 'SUBSCRIPTION', 'MEMBERSHIP', 'PRO', 'BASIC',
  'STANDARD', 'MONTHLY', 'ANNUAL', 'RECURRING', 'PAYMENT', 'PURCHASE', 'ONLINE', 'STORE',
  'CORP', 'SVC', 'SERVICES', 'LOS', 'GATOS'
]);
const brandTokens = (s: string) => String(s).toUpperCase().split(/[^A-Z]+/).filter(w => w.length >= 3 && !BRAND_STOP.has(w));

// Cluster charges that belong to the SAME vendor even when the bank labels them
// differently from one charge to the next ("ADOBE CC" / "ADOBE SYSTEMS INC", "DISNEY+
// BUNDLE" / "DISNEYPLUS.COM", "MICROSOFT 365 PERSONAL" / "MSFT*365 PERSONAL"). Two
// charges are linked when they share a brand word — exactly, or where one word is a
// prefix of the other (DISNEY ⊂ DISNEYPLUS). Linking is done with union-find so it's
// transitive: variants that only connect through a chain (MICROSOFT … PERSONAL … MSFT)
// still collapse into one cluster, regardless of the order charges arrive in. A charge
// with no usable brand word ("YT PREMIUM") is attached to a cluster billed at the same
// amount. Fully dynamic — no hardcoded vendor list.
function clusterByVendor(rows: Tx[]): Array<[string, Tx[]]> {
  const toks = rows.map(t => brandTokens(`${t.merchant} ${t.name}`));
  const parent = rows.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const tokMap: Record<string, number[]> = {};
  rows.forEach((_, i) => toks[i].forEach(k => (tokMap[k] ||= []).push(i)));
  for (const idxs of Object.values(tokMap)) for (const i of idxs) union(i, idxs[0]);          // share exact word
  const allToks = Object.keys(tokMap);
  for (const a of allToks) for (const b of allToks)                                            // prefix word (DISNEY⊂DISNEYPLUS)
    if (a !== b && a.length >= 4 && b.startsWith(a)) union(tokMap[a][0], tokMap[b][0]);
  // Assemble connected components; brand-less charges become orphans handled below.
  const comp: Record<number, Tx[]> = {};
  const compToks: Record<number, string[]> = {};
  const orphans: Tx[] = [];
  rows.forEach((t, i) => {
    if (!toks[i].length) { orphans.push(t); return; }
    const r = find(i); (comp[r] ||= []).push(t); (compToks[r] ||= []).push(...toks[i]);
  });
  const clusters = Object.keys(comp).map(r => ({ rows: comp[+r], toks: compToks[+r] }));
  const amtOf = (rs: Tx[]) => median(rs.map(t => Math.abs(t.amount)));
  // Brand-less charges (grouped by their identical raw label) join a cluster billed at
  // the same amount, so a descriptor-only variant still lands with its vendor.
  const byName: Record<string, Tx[]> = {};
  for (const o of orphans) (byName[o.merchant || o.name] ||= []).push(o);
  for (const grp of Object.values(byName)) {
    const med = amtOf(grp);
    const c = clusters.find(cl => Math.abs(amtOf(cl.rows) - med) <= Math.max(amtOf(cl.rows) * 0.02, 0.5));
    if (c) c.rows.push(...grp); else clusters.push({ rows: [...grp], toks: [] });
  }
  // Label with the most identifying brand word (the longest beats short/generic ones).
  const niceLabel = (c: { rows: Tx[]; toks: string[] }) => {
    const cnt: Record<string, number> = {};
    for (const k of c.toks) cnt[k] = (cnt[k] || 0) + 1;
    const top = Object.keys(cnt).sort((a, b) => b.length - a.length || cnt[b] - cnt[a])[0];
    return top ? top[0] + top.slice(1).toLowerCase() : (c.rows[0].merchant || c.rows[0].name);
  };
  return clusters.map(c => [niceLabel(c), c.rows] as [string, Tx[]]);
}

// The category a cluster mostly falls in (charges for one vendor occasionally land in
// different categories across the variants, so go with the most common).
const domCategory = (rows: Tx[]) => {
  const c: Record<string, number> = {};
  for (const t of rows) c[t.category] = (c[t.category] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1])[0][0];
};

export function detectRecurring(tx: Tx[], now?: string) {
  // "Now" is the real current date, so ACTIVE reflects how recently a subscription
  // charged relative to TODAY — not relative to the newest row in the file (which
  // would wrongly keep things "active" when a dataset contains future-dated rows).
  const today = now || new Date().toISOString().slice(0, 10);
  // Eligible charges: money out, excluding categories that are never subscriptions. We
  // keep EVERY charge (including any future-dated rows) so the billed-times count is the
  // TOTAL number of charges for a vendor; whether it's still ACTIVE is judged separately
  // against today, using only charges that have actually happened.
  const eligible = tx.filter(t => t.amount < 0 && !NON_SUBSCRIPTION_CATS.has(t.category));
  const groups = clusterByVendor(eligible);

  const subs: Recurring[] = [];
  for (const [merchant, allRaw] of groups) {
    if (allRaw.length < 3) continue;                       // need a real repeating history (3+)
    const all = [...allRaw].sort((a, b) => (a.date < b.date ? -1 : 1));
    const category = domCategory(all);
    const isSubCat = category === 'Subscriptions & Digital';
    // A subscription charges the SAME amount each time. Keep only the charges at the
    // dominant amount within a TIGHT tolerance (~2% or 50c), and require at least 3.
    const med = median(all.map(t => Math.abs(t.amount)));
    if (med <= 0) continue;
    const tol = Math.max(med * 0.02, 0.5);
    const charges = all.filter(t => Math.abs(Math.abs(t.amount) - med) <= tol);
    if (charges.length < 3) continue;                      // 3+ identical-amount charges
    // The most recent charge that has actually happened as of today. Future-dated rows
    // still count toward the total billed count, but only real (past) charges decide
    // whether the subscription is still active and when it last / next bills.
    const occurred = charges.map(c => c.date).filter(d => d <= today);
    const lastOccurred = occurred.length ? occurred[occurred.length - 1] : null;
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
    let lastCharged = lastOccurred || charges[charges.length - 1].date;
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
      lastCharged = lastOccurred || all[all.length - 1].date;
    }

    // Active = it charged recently relative to TODAY (using the last real charge, never a
    // future-dated row). Period-aware with ~2 billing cycles of slack (about two months
    // for a monthly plan) to tolerate a late or skipped charge before calling it lapsed.
    const active = lastOccurred != null && (Date.parse(today) - Date.parse(lastOccurred)) / DAY <= period * 2 + 3;
    const confidence = Math.min(1, (charges.length >= 4 ? 0.6 : charges.length === 3 ? 0.45 : 0.3) + (spread < 0.2 ? 0.3 : spread < 0.4 ? 0.15 : 0) + (isSubCat ? 0.1 : 0));
    subs.push({
      merchant, category, amount, cadence: label, periodDays: Math.round(period),
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

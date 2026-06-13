// Subscription / recurring-charge detection. Finds merchants charged on a
// regular cadence for a consistent amount, decides which are still ACTIVE, and
// computes monthly/annual cost. Pure function over the user's transactions.
import type { Tx } from './store.js';

export interface Recurring {
  merchant: string; category: string;
  amount: number;          // typical per-charge amount (positive)
  cadence: string;         // Weekly | Biweekly | Monthly | Quarterly | Yearly
  periodDays: number;
  monthlyCost: number; annualCost: number;
  lastCharged: string; nextCharge: string;
  count: number; active: boolean; confidence: number; // 0..1
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

export function detectRecurring(tx: Tx[]) {
  const anchor = tx.length ? tx[tx.length - 1].date : new Date().toISOString().slice(0, 10);
  const groups: Record<string, Tx[]> = {};
  for (const t of tx) if (t.amount < 0) { const k = t.merchant || t.name; (groups[k] ||= []).push(t); }

  const subs: Recurring[] = [];
  for (const [merchant, allRaw] of Object.entries(groups)) {
    if (allRaw.length < 2) continue;
    const all = [...allRaw].sort((a, b) => (a.date < b.date ? -1 : 1));
    // consistent amount: keep charges near the median
    const med = median(all.map(t => Math.abs(t.amount)));
    if (med <= 0) continue;
    const tol = Math.max(med * 0.15, 2);
    const charges = all.filter(t => Math.abs(Math.abs(t.amount) - med) <= tol);
    if (charges.length < 2) continue;
    // cadence from gaps between consecutive charges
    const gaps: number[] = [];
    for (let i = 1; i < charges.length; i++) gaps.push((Date.parse(charges[i].date) - Date.parse(charges[i - 1].date)) / DAY);
    const medGap = median(gaps);
    const cad = cadenceFor(medGap);
    const isSubCat = charges[0].category === 'Subscriptions & Digital';
    if (!cad && !(isSubCat && charges.length >= 3)) continue;
    const period = cad?.period || medGap || 30.44;
    const label = cad?.label || (medGap >= 26 && medGap <= 35 ? 'Monthly' : 'Recurring');
    // regularity: low spread of gaps relative to the period
    const spread = gaps.length ? median(gaps.map(g => Math.abs(g - medGap))) / Math.max(1, medGap) : 1;
    const amount = r2(median(charges.map(t => Math.abs(t.amount))));
    const lastCharged = charges[charges.length - 1].date;
    const sinceLast = (Date.parse(anchor) - Date.parse(lastCharged)) / DAY;
    const active = sinceLast <= period * 1.5 + 3;
    const confidence = Math.min(1, (charges.length >= 4 ? 0.6 : charges.length === 3 ? 0.45 : 0.3) + (spread < 0.2 ? 0.3 : spread < 0.4 ? 0.15 : 0) + (isSubCat ? 0.1 : 0));
    subs.push({
      merchant, category: charges[0].category, amount, cadence: label, periodDays: Math.round(period),
      monthlyCost: r2(amount * 30.44 / period), annualCost: r2(amount * 365 / period),
      lastCharged, nextCharge: shift(lastCharged, Math.round(period)),
      count: charges.length, active, confidence: r2(confidence)
    });
  }

  subs.sort((a, b) => (a.active === b.active ? b.monthlyCost - a.monthlyCost : a.active ? -1 : 1));
  const activeSubs = subs.filter(s => s.active);
  return {
    subscriptions: subs,
    totals: {
      activeCount: activeSubs.length,
      monthlyTotal: r2(activeSubs.reduce((s, x) => s + x.monthlyCost, 0)),
      annualTotal: r2(activeSubs.reduce((s, x) => s + x.annualCost, 0))
    }
  };
}

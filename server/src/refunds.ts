// Refund netting. A purchase that was later returned/refunded (e.g. buy $50 at
// Walmart, refunded $50) should not inflate money-OUT for the charge nor money-IN
// for the refund — the two cancel. We pair each refund (an inflow) with an earlier
// charge (an outflow) at the SAME merchant for the EXACT same amount, within a
// 60-day window. "Full refunds only": magnitudes must match to the cent; partial
// refunds are left untouched. Each charge and each refund is paired at most once.
//
// Matched pairs are EXCLUDED from income/spend totals everywhere they're computed,
// but kept for display in the ledger (tagged), so nothing silently disappears.
import type { Tx } from './store.js';

const WINDOW_DAYS = 60;

// Stable merchant key: prefer the merchant field, fall back to the raw name.
const key = (t: Tx) => (t.merchant || t.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
// Compare money in integer cents to avoid float wobble on NUMERIC(14,2) values.
const cents = (n: number) => Math.round(Math.abs(n) * 100);
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

export interface RefundInfo {
  nettedIds: Set<string>;                       // ids to drop from money in/out
  roleById: Map<string, 'charge' | 'refund'>;   // for ledger tagging
}

// Find full-refund charge/refund pairs across a user's full transaction set.
export function detectRefunds(tx: Tx[]): RefundInfo {
  const nettedIds = new Set<string>();
  const roleById = new Map<string, 'charge' | 'refund'>();

  // Index outflows by merchant key for quick candidate lookup.
  const chargesByKey = new Map<string, Tx[]>();
  for (const t of tx) {
    if (t.amount >= 0) continue;
    const k = key(t);
    if (!k) continue;
    const list = chargesByKey.get(k);
    if (list) list.push(t); else chargesByKey.set(k, [t]);
  }

  // Process refunds oldest→newest so earlier refunds claim their charge first.
  const refunds = tx.filter(t => t.amount > 0).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const r of refunds) {
    const k = key(r);
    if (!k) continue;
    const pool = chargesByKey.get(k);
    if (!pool) continue;
    // Best candidate = an unused charge of equal magnitude, dated on/before the
    // refund and no more than WINDOW_DAYS earlier; pick the closest (most recent).
    let best: Tx | null = null;
    for (const c of pool) {
      if (nettedIds.has(c.id)) continue;
      if (cents(c.amount) !== cents(r.amount)) continue;
      if (c.date > r.date) continue;
      if (daysBetween(c.date, r.date) > WINDOW_DAYS) continue;
      if (!best || c.date > best.date) best = c;
    }
    if (best) {
      nettedIds.add(best.id); roleById.set(best.id, 'charge');
      nettedIds.add(r.id); roleById.set(r.id, 'refund');
    }
  }

  return { nettedIds, roleById };
}

// Return only the rows that count toward money in/out (refund pairs removed).
// Pass the user's FULL transaction set so cross-period pairs net correctly.
export function withoutRefunds(tx: Tx[]): Tx[] {
  const { nettedIds } = detectRefunds(tx);
  return nettedIds.size ? tx.filter(t => !nettedIds.has(t.id)) : tx;
}

// Refund netting. A purchase that was later returned/refunded (e.g. buy $50 at
// Walmart, refunded $50) should not inflate money-OUT for the charge nor money-IN
// for the refund — the two cancel. We pair each refund (an inflow) with an earlier
// charge (an outflow) for the EXACT same amount, within a 60-day window. "Full
// refunds only": magnitudes must match to the cent; partial refunds are left
// untouched. Each charge and each refund is paired at most once.
//
// Matched pairs are EXCLUDED from income/spend totals everywhere they're computed,
// but kept for display in the ledger (tagged), so nothing silently disappears.
import type { Tx } from './store.js';
import { isInternalTransfer } from './transfers.js';
import { isMovement, looksLikeIncome } from './classifier.js';

const WINDOW_DAYS = 60;

// Tokens that describe HOW/where a charge posted, not WHO it was with: posting
// direction, payment rails, and the words a bank tacks onto a return/credit. A charge
// and its refund routinely carry DIFFERENT descriptors for the same vendor — the bank
// prefixes the direction ("Withdrawal …" vs "Deposit …") and may add "RETURN" /
// "REVERSAL" / "REFUND" — so a raw-string compare misses the pair and both sides keep
// inflating totals. Stripping this noise reduces both rows to the same vendor key.
const NOISE = new Set([
  'WITHDRAWAL', 'WITHDRAW', 'WDL', 'DEPOSIT', 'DEBIT', 'CREDIT', 'POS', 'ATM',
  'ACH', 'VSA', 'VISA', 'MASTERCARD', 'MC', 'CARD', 'RECURRING', 'PUR', 'PURCHASE', 'PMT', 'PAYMENT', 'TST', 'SQ',
  'RETURN', 'RETURNS', 'REFUND', 'REFUNDED', 'REVERSAL', 'REVERSE', 'RTN', 'ADJUSTMENT', 'CHARGEBACK', 'VOUCHER',
  'LLC', 'INC', 'CO', 'LTD', 'THE', 'AND', 'FOR', 'BILL', 'BILLING', 'ONLINE', 'STORE', 'USA', 'COM', 'UNKNOWN'
]);
const tokensFrom = (s: string) => Array.from(new Set(String(s).toUpperCase().split(/[^A-Z]+/).filter(w => w.length >= 3 && !NOISE.has(w))));
// Vendor key, descriptor-robust. Prefer the cleaned `merchant` (already brand-only, no
// city or store number, so two locations of the same chain still match); fall back to
// the raw descriptor only when `merchant` is all-noise — the bank's direction-word
// fallback ("Withdrawal Debit Card") that the merchant cleaner leaves for an unlisted
// vendor. Sorted unique tokens make the key order-independent.
const key = (t: Tx) => {
  let toks = tokensFrom(t.merchant || '');
  if (!toks.length) toks = tokensFrom(t.name || '');
  return toks.sort().join(' ');
};
// Compare money in integer cents to avoid float wobble on NUMERIC(14,2) values.
const cents = (n: number) => Math.round(Math.abs(n) * 100);
const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 864e5;

// A GENERIC, anonymous deposit: a credit whose descriptor carries no merchant identity
// at all — "MOBILE DEPOSIT", a redeposited check, an ATM/teller credit, a bank memo.
// These are the ONLY inflows eligible for amount-only refund matching (Pass 2): a credit
// that names a different store ("Target") must never cancel a charge at another store.
const DEPOSIT_NOISE = new Set([...NOISE,
  'MOBILE', 'CHECK', 'CHEQUE', 'TELLER', 'BRANCH', 'COUNTER', 'DEP', 'REDEPOSIT', 'EDEPOSIT',
  'REMOTE', 'IMAGE', 'ITEM', 'OFFSET', 'MISC', 'ADJ', 'MEMO', 'BANK', 'FUNDS', 'DDA', 'PENDING']);
const isGenericDeposit = (t: Tx) => {
  const toks = `${t.merchant || ''} ${t.name || ''}`.toUpperCase().split(/[^A-Z]+/).filter(w => w.length >= 3 && !DEPOSIT_NOISE.has(w));
  return toks.length === 0;
};

export interface RefundInfo {
  nettedIds: Set<string>;                       // ids to drop from money in/out
  roleById: Map<string, 'charge' | 'refund'>;   // for ledger tagging
}

// Find full-refund charge/refund pairs across a user's full transaction set.
export function detectRefunds(tx: Tx[]): RefundInfo {
  const nettedIds = new Set<string>();
  const roleById = new Map<string, 'charge' | 'refund'>();

  // Index outflows by merchant key for quick candidate lookup. Internal-transfer
  // legs are skipped: moving money between your own accounts isn't a purchase, and a
  // generic "Home Banking Transfer" descriptor would otherwise collide with its
  // opposite leg and net out wrongly. Those are the job of transfers.ts.
  const chargesByKey = new Map<string, Tx[]>();
  for (const t of tx) {
    if (t.amount >= 0) continue;
    if (isInternalTransfer(t)) continue;
    const k = key(t);
    if (!k) continue;
    const list = chargesByKey.get(k);
    if (list) list.push(t); else chargesByKey.set(k, [t]);
  }

  // ---- Pass 1: same-vendor match (high confidence) ----
  // Process refunds oldest→newest so earlier refunds claim their charge first.
  const refunds = tx.filter(t => t.amount > 0 && !isInternalTransfer(t)).sort((a, b) => (a.date < b.date ? -1 : 1));
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

  // ---- Pass 2: amount-only fallback (no shared vendor) ----
  // Some refunds come back with NO link to the original merchant: a returned check
  // redeposited as a generic "MOBILE DEPOSIT", a bank reversal, a manual credit. The
  // only signal is that an inflow exactly equals a recent prior OUTFLOW. We pair on
  // exact amount + time order, deliberately ignoring the descriptor. Safeguards keep it
  // conservative: neither leg may be an internal transfer; the outflow can't be money
  // movement (don't cancel a loan/transfer payment); and the inflow can't read as real
  // income (payroll, interest, tax refund) — so a paycheck is never eaten by a same-
  // amount expense. Each row pairs at most once; nearest prior charge wins.
  const spentOut = tx.filter(t => t.amount < 0 && !nettedIds.has(t.id) && !isInternalTransfer(t) && !isMovement(t.category));
  const otherIns = tx.filter(t => t.amount > 0 && !nettedIds.has(t.id) && !isInternalTransfer(t)
      && isGenericDeposit(t) && !looksLikeIncome(t.name || ''))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const r of otherIns) {
    let best: Tx | null = null;
    for (const c of spentOut) {
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

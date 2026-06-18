// Internal-transfer netting. When a user moves money between their OWN accounts
// (e.g. checking -> savings) and both accounts are imported, the move shows up
// twice: an outflow in the source account and an inflow in the destination. Left
// alone, the inflow inflates income and the outflow inflates spending — the same
// dollars counted on both sides of the budget. We pair each internal-transfer
// outflow with a matching inflow of the SAME magnitude within a few days and
// EXCLUDE both from income/spend totals, mirroring refund netting (see refunds.ts).
//
// Matched pairs are removed from every total that's computed, but kept in the
// ledger (tagged), so nothing silently disappears. External P2P (Venmo/Zelle/
// PayPal) is intentionally NOT matched here — that's money leaving for someone
// else, not a move between the user's own accounts.
import type { Tx } from './store.js';

// Transfers between accounts post on the same day or within a day or two.
const WINDOW_DAYS = 5;

// "Internal transfer" requires BOTH the word transfer (or xfer) AND an account-ish
// source/target token, so ordinary purchases and external P2P never qualify.
const TRANSFER_WORD_RE = /\b(transfer|xfer)\b/i;
const ACCOUNT_TOKEN_RE = /\b(shares?|savings?|saver|checking|chk|sav|money ?market|acct|account)\b|home banking/i;

export function isInternalTransfer(t: Tx): boolean {
  const s = `${t.name || ''} ${t.merchant || ''}`;
  return TRANSFER_WORD_RE.test(s) && ACCOUNT_TOKEN_RE.test(s);
}

const cents = (n: number) => Math.round(Math.abs(n) * 100);
const daysApart = (a: string, b: string) => Math.abs(Date.parse(b) - Date.parse(a)) / 864e5;

export interface TransferInfo {
  nettedIds: Set<string>;                                  // ids to drop from money in/out
  roleById: Map<string, 'transfer_out' | 'transfer_in'>;   // for ledger tagging
}

// A transaction's account label: the CSV's Account column, or a linked bank
// account name (Plaid). Lowercased + trimmed for stable comparison. Empty means
// "unknown account" — such rows are NOT eligible for netting.
const accountOf = (t: Tx) => (t.account || '').trim().toLowerCase();

// Find internal-transfer out/in pairs across a user's full transaction set.
// Per product rule, a pair is netted ONLY when BOTH legs are tied to a KNOWN
// account the user has (the CSV Account column, or an account within a linked
// Plaid bank) AND those two accounts are DIFFERENT — i.e. the money genuinely
// moved between two of the user's own accounts. A transfer with no identifiable
// second account (e.g. a single-account CSV, or money sent to an outside account)
// is left counted, since we can't prove it stayed between the user's accounts.
export function detectTransfers(tx: Tx[]): TransferInfo {
  const nettedIds = new Set<string>();
  const roleById = new Map<string, 'transfer_out' | 'transfer_in'>();

  // Eligible = described as an internal transfer AND tied to a known account.
  const transfers = tx.filter(t => isInternalTransfer(t) && accountOf(t));
  const outs = transfers.filter(t => t.amount < 0);
  // Process inflows oldest -> newest so earlier transfers claim their match first.
  const ins = transfers.filter(t => t.amount > 0).sort((a, b) => (a.date < b.date ? -1 : 1));

  for (const inc of ins) {
    // Best match = an unused outflow of equal magnitude, in a DIFFERENT account,
    // dated within WINDOW_DAYS (either side — a transfer can post out- or in-first);
    // pick the closest.
    let best: Tx | null = null;
    for (const o of outs) {
      if (nettedIds.has(o.id)) continue;
      if (cents(o.amount) !== cents(inc.amount)) continue;
      if (accountOf(o) === accountOf(inc)) continue; // must move BETWEEN two accounts
      if (daysApart(o.date, inc.date) > WINDOW_DAYS) continue;
      if (!best || daysApart(o.date, inc.date) < daysApart(best.date, inc.date)) best = o;
    }
    if (best) {
      nettedIds.add(best.id); roleById.set(best.id, 'transfer_out');
      nettedIds.add(inc.id); roleById.set(inc.id, 'transfer_in');
    }
  }
  return { nettedIds, roleById };
}

// Return only the rows that count toward money in/out (transfer pairs removed).
// Pass the user's FULL transaction set so cross-account pairs net correctly.
export function withoutTransfers(tx: Tx[]): Tx[] {
  const { nettedIds } = detectTransfers(tx);
  return nettedIds.size ? tx.filter(t => !nettedIds.has(t.id)) : tx;
}

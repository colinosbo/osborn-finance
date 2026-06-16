// Investment balance snapshots: capture each account's balance over time so the
// reports Investments section can show change-in-value across a month.
//
// Cost model: opportunistic captures piggyback on syncs that already happen (free).
// The scheduled job only touches Plaid on capture days (1st, 15th, last of month)
// and only for items that actually hold an investment account, keeping billable
// Balance calls to ~3 per investment item per month.
import type { Store, Account } from './store.js';
import { Plaid } from './plaid.js';
import { cfg } from './config.js';

// Plaid account subtypes we treat as investments/retirement.
const INVESTMENT_TYPES = new Set([
  'investment', 'brokerage', 'ira', 'roth', 'roth 401k', '401k', '401a', '403b', '457b',
  '529', 'hsa', 'retirement', 'mutual fund', 'mutual_fund', 'sep ira', 'simple ira',
  'pension', 'profit sharing plan', 'ugma', 'utma', 'crypto', 'cash management', 'tsp',
  'money market', 'cd', 'certificate of deposit'
]);
export const isInvestmentType = (t: string) => INVESTMENT_TYPES.has((t || '').toLowerCase());

const r2 = (n: number) => Math.round(n * 100) / 100;
const todayISO = () => new Date().toISOString().slice(0, 10);
const isoUTC = (y: number, mZero: number, day: number) => new Date(Date.UTC(y, mZero, day)).toISOString().slice(0, 10);

// True on the 1st, the 15th, and the actual last day of the month (28 to 31).
export function isCaptureDay(d = new Date()): boolean {
  const day = d.getUTCDate();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  return day === 1 || day === 15 || day === last;
}

// Persist today's balances for the given accounts (idempotent per account/day).
export async function captureSnapshots(store: Store, userId: string, accounts: Account[], date = todayISO()) {
  if (!accounts.length) return;
  await store.recordSnapshots(accounts.map(a => ({ account_id: a.id, user_id: userId, date, balance: r2(a.current_balance) })));
}

// MOCK ONLY: give investment accounts a believable start/mid snapshot so the
// Investments section shows month-over-month change without waiting a real month.
// Never runs against live Plaid data.
export async function seedMockHistory(store: Store, userId: string, accounts: Account[]) {
  if (!cfg.plaid.mock) return;
  const inv = accounts.filter(a => isInvestmentType(a.type));
  if (!inv.length) return;
  const now = new Date();
  const first = isoUTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const mid = isoUTC(now.getUTCFullYear(), now.getUTCMonth(), 15);
  const existing = await store.listSnapshots(userId, inv.map(a => a.id));
  const have = new Set(existing.map(s => s.account_id + s.date));
  const rows = [];
  for (const a of inv) {
    if (now.getUTCDate() > 1 && !have.has(a.id + first)) rows.push({ account_id: a.id, user_id: userId, date: first, balance: r2(a.current_balance * 0.94) });
    if (now.getUTCDate() >= 15 && !have.has(a.id + mid)) rows.push({ account_id: a.id, user_id: userId, date: mid, balance: r2(a.current_balance * 0.975) });
  }
  if (rows.length) await store.recordSnapshots(rows);
}

// Scheduled capture: refresh balances from Plaid only for investment-holding items.
// Returns counts so callers can log the run.
export async function runScheduledCapture(store: Store, decrypt: (blob: string) => string): Promise<{ items: number; accounts: number }> {
  const items = await store.allItems();
  let nItems = 0, nAcc = 0;
  for (const it of items) {
    const accts = (await store.listAccounts(it.user_id)).filter(a => a.item_id === it.id);
    if (!accts.some(a => isInvestmentType(a.type))) continue; // skip non-investment items entirely
    try {
      const fresh = await Plaid.getAccounts(decrypt(it.access_token_ciphertext)); // billable Balance call
      await store.upsertAccounts(fresh.map(a => ({
        item_id: it.id, user_id: it.user_id, plaid_account_id: a.account_id,
        name: a.name, mask: a.mask, type: a.type, current_balance: a.balance
      })));
      const inv = (await store.listAccounts(it.user_id)).filter(a => a.item_id === it.id && isInvestmentType(a.type));
      await captureSnapshots(store, it.user_id, inv);
      nItems++; nAcc += inv.length;
    } catch { /* skip this item on error; the last good snapshot stands */ }
  }
  return { items: nItems, accounts: nAcc };
}

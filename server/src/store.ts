// Data layer: PgStore for production (DATABASE_URL), MemStore for dev/tests.
import { randomUUID } from 'crypto';
import { cfg } from './config.js';

export interface User { id: string; email: string; display_name: string | null; plan: string; stripe_customer_id: string | null; }
export interface Tx { id: string; user_id: string; date: string; name: string; merchant: string; amount: number; balance: number | null; category: string; source: string; plaid_transaction_id?: string | null; item_id?: string | null; account?: string | null; pinned?: boolean | null; manual_refund?: boolean | null; }
export interface Item { id: string; user_id: string; plaid_item_id: string; institution_name: string; access_token_ciphertext: string; sync_cursor: string | null; status: string; }
export interface Account { id: string; item_id: string; user_id: string; plaid_account_id: string; name: string; mask: string; type: string; current_balance: number; }
// Investment tracking: a point-in-time balance for one account (see migration 007).
export interface Snapshot { account_id: string; user_id: string; date: string; balance: number; }
export interface Subscription { user_id: string; stripe_subscription_id: string | null; plan: string; status: string; current_period_end: string | null; }
export interface Store {
  getOrCreateUser(email: string): Promise<User>;
  getUser(id: string): Promise<User | null>;
  setPlan(userId: string, plan: string, stripeCustomerId?: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  insertTx(rows: Omit<Tx, 'id'>[]): Promise<number>;
  listTx(userId: string, q: { from?: string; to?: string; cat?: string; flow?: string; search?: string; limit: number; offset: number; sort: string; dir: string; accounts?: string[] }): Promise<{ rows: Tx[]; total: number }>;
  allTx(userId: string, from?: string): Promise<Tx[]>;
  // Count of existing transactions per dedup key (`date|amount|name`), used for
  // count-aware CSV import: a re-imported row is skipped only up to the number
  // that already exist, so legitimate same-day repeats still import.
  txCounts(userId: string): Promise<Map<string, number>>;
  setCategoryByMerchant(userId: string, merchant: string, category: string): Promise<number>;
  setTxCategories(userId: string, updates: { id: string; category: string }[]): Promise<number>;
  pinTx(userId: string, id: string, category: string): Promise<boolean>;
  getOverrides(userId: string): Promise<Record<string, string>>;
  setOverride(userId: string, merchantKey: string, category: string): Promise<void>;
  addItem(it: Omit<Item, 'id'>): Promise<Item>;
  listItems(userId: string): Promise<Item[]>;
  removeItem(userId: string, itemId: string): Promise<void>;
  countItems(userId: string): Promise<number>;
  setCursor(itemId: string, cursor: string): Promise<void>;
  setItemStatus(itemId: string, status: string): Promise<void>;
  itemByPlaidId(plaidItemId: string): Promise<Item | null>;
  upsertAccounts(rows: Omit<Account, 'id'>[]): Promise<void>;
  listAccounts(userId: string): Promise<Account[]>;
  allItems(): Promise<Item[]>;
  recordSnapshots(rows: Snapshot[]): Promise<void>;
  listSnapshots(userId: string, accountIds: string[]): Promise<Snapshot[]>;
  upsertSubscription(sub: Subscription): Promise<void>;
  getSubscription(userId: string): Promise<Subscription | null>;
  userByStripeCustomer(customerId: string): Promise<User | null>;
  getOrCreateUserBySub(sub: string, email: string): Promise<User>;
  audit(userId: string | null, event: string, detail?: string, ipHash?: string): Promise<void>;
}

/* ---------------- in-memory store ---------------- */
class MemStore implements Store {
  users = new Map<string, User>();
  tx = new Map<string, Tx[]>();
  overrides = new Map<string, Record<string, string>>();
  items = new Map<string, Item[]>();
  auditLog: Array<{ user_id: string | null; event: string; detail?: string; ip_hash?: string; at: string }> = [];

  async getOrCreateUser(email: string) {
    for (const u of this.users.values()) if (u.email === email) return u;
    const u: User = { id: randomUUID(), email, display_name: email.split('@')[0], plan: 'free', stripe_customer_id: null };
    this.users.set(u.id, u);
    return u;
  }
  async getUser(id: string) { return this.users.get(id) || null; }
  async setPlan(userId: string, plan: string, sc?: string) {
    const u = this.users.get(userId); if (u) { u.plan = plan; if (sc) u.stripe_customer_id = sc; }
  }
  async deleteUser(userId: string) { this.users.delete(userId); this.tx.delete(userId); this.overrides.delete(userId); this.items.delete(userId); }
  async insertTx(rows: Omit<Tx, 'id'>[]) {
    for (const r of rows) {
      const list = this.tx.get(r.user_id) || [];
      list.push({ ...r, id: randomUUID() });
      this.tx.set(r.user_id, list);
    }
    return rows.length;
  }
  async allTx(userId: string, from?: string) {
    let rows = this.tx.get(userId) || [];
    if (from) rows = rows.filter(t => t.date > from);
    return [...rows].sort((a, b) => a.date < b.date ? -1 : 1);
  }
  async listTx(userId: string, q: { from?: string; to?: string; cat?: string; flow?: string; search?: string; limit: number; offset: number; sort: string; dir: string; accounts?: string[] }) {
    let rows = await this.allTx(userId, q.from);
    if (q.to) rows = rows.filter(t => t.date <= q.to!);
    if (q.cat) rows = rows.filter(t => t.category === q.cat);
    if (q.flow === 'in') rows = rows.filter(t => t.amount > 0);
    if (q.flow === 'out') rows = rows.filter(t => t.amount < 0);
    if (q.accounts?.length) rows = rows.filter(t => t.account != null && q.accounts!.includes(t.account));
    if (q.search) { const s = q.search.toLowerCase(); rows = rows.filter(t => t.name.toLowerCase().includes(s) || t.merchant.toLowerCase().includes(s)); }
    const dir = q.dir === 'asc' ? 1 : -1;
    if (q.sort === 'amount') {
      // Sort by transaction size (magnitude), so descending puts the biggest
      // transaction at the top regardless of whether it's money in or out.
      rows.sort((a, b) => (Math.abs(a.amount) - Math.abs(b.amount)) * dir);
    } else {
      const k = q.sort as keyof Tx;
      rows.sort((a, b) => ((a[k] ?? '') < (b[k] ?? '') ? -1 : 1) * dir);
    }
    return { rows: rows.slice(q.offset, q.offset + q.limit), total: rows.length };
  }
  async txCounts(userId: string) {
    const m = new Map<string, number>();
    for (const t of this.tx.get(userId) || []) {
      const k = `${t.date}|${t.amount}|${t.name}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  }
  async setCategoryByMerchant(userId: string, merchant: string, category: string) {
    let n = 0;
    for (const t of this.tx.get(userId) || []) if (t.merchant === merchant && t.amount < 0) { t.category = category; n++; }
    return n;
  }
  async setTxCategories(userId: string, updates: { id: string; category: string }[]) {
    if (!updates.length) return 0;
    const byId = new Map(updates.map(x => [x.id, x.category]));
    let n = 0;
    for (const t of this.tx.get(userId) || []) { const c = byId.get(t.id); if (c !== undefined && t.category !== c) { t.category = c; n++; } }
    return n;
  }
  async pinTx(userId: string, id: string, category: string): Promise<boolean> {
    const tx = this.tx.get(userId) || [];
    const t = tx.find(x => x.id === id);
    if (!t) return false;
    t.category = category; t.pinned = true;
    return true;
  }
  async getOverrides(userId: string) { return this.overrides.get(userId) || {}; }
  async setOverride(userId: string, mk: string, cat: string) {
    const o = this.overrides.get(userId) || {}; o[mk] = cat; this.overrides.set(userId, o);
  }
  async addItem(it: Omit<Item, 'id'>) {
    const item: Item = { ...it, id: randomUUID() };
    const list = this.items.get(it.user_id) || []; list.push(item); this.items.set(it.user_id, list);
    return item;
  }
  async listItems(userId: string) { return this.items.get(userId) || []; }
  async removeItem(userId: string, itemId: string) {
    this.items.set(userId, (this.items.get(userId) || []).filter(i => i.id !== itemId));
    // FIX: also drop that bank's transactions so they stop showing after unlink.
    this.tx.set(userId, (this.tx.get(userId) || []).filter(t => t.item_id !== itemId));
    this.accounts.set(userId, (this.accounts.get(userId) || []).filter(a => a.item_id !== itemId));
  }
  async countItems(userId: string) { return (this.items.get(userId) || []).length; }
  async setCursor(itemId: string, cursor: string) {
    for (const list of this.items.values()) for (const i of list) if (i.id === itemId) i.sync_cursor = cursor;
  }
  async setItemStatus(itemId: string, status: string) {
    for (const list of this.items.values()) for (const i of list) if (i.id === itemId) i.status = status;
  }
  async itemByPlaidId(plaidItemId: string) {
    for (const list of this.items.values()) for (const i of list) if (i.plaid_item_id === plaidItemId) return i;
    return null;
  }
  accounts = new Map<string, Account[]>();
  async upsertAccounts(rows: Omit<Account, 'id'>[]) {
    for (const r of rows) {
      const list = this.accounts.get(r.user_id) || [];
      const ex = list.find(a => a.plaid_account_id === r.plaid_account_id);
      if (ex) ex.current_balance = r.current_balance;
      else list.push({ ...r, id: randomUUID() });
      this.accounts.set(r.user_id, list);
    }
  }
  async listAccounts(userId: string) { return this.accounts.get(userId) || []; }
  async allItems() { return [...this.items.values()].flat(); }
  snapshots = new Map<string, Snapshot[]>();
  async recordSnapshots(rows: Snapshot[]) {
    for (const r of rows) {
      const list = this.snapshots.get(r.user_id) || [];
      const ex = list.find(s => s.account_id === r.account_id && s.date === r.date);
      if (ex) ex.balance = r.balance;            // idempotent per (account, day)
      else list.push({ ...r });
      this.snapshots.set(r.user_id, list);
    }
  }
  async listSnapshots(userId: string, accountIds: string[]) {
    const set = new Set(accountIds);
    return (this.snapshots.get(userId) || []).filter(s => set.has(s.account_id)).sort((a, b) => a.date < b.date ? -1 : 1);
  }
  subs = new Map<string, Subscription>();
  async upsertSubscription(sub: Subscription) { this.subs.set(sub.user_id, sub); }
  async getSubscription(userId: string) { return this.subs.get(userId) || null; }
  async userByStripeCustomer(customerId: string) {
    for (const u of this.users.values()) if (u.stripe_customer_id === customerId) return u;
    return null;
  }
  async getOrCreateUserBySub(sub: string, email: string) {
    for (const u of this.users.values()) if ((u as never as { entra_sub?: string }).entra_sub === sub) return u;
    const u = await this.getOrCreateUser(email);
    (u as never as { entra_sub?: string }).entra_sub = sub;
    return u;
  }
  async audit(user_id: string | null, event: string, detail?: string, ip_hash?: string) {
    this.auditLog.push({ user_id, event, detail, ip_hash, at: new Date().toISOString() });
  }
}

/* ---------------- postgres store ---------------- */
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

class PgStore implements Store {
  pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10000 }); }
  async migrate() {
    // INC-5: track applied migrations so non-idempotent files never double-run.
    await this.pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set((await this.pool.query(`SELECT filename FROM schema_migrations`)).rows.map((r: { filename: string }) => r.filename));
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
    for (const f of readdirSync(dir).sort()) {
      if (applied.has(f)) continue;
      await this.pool.query(readFileSync(join(dir, f), 'utf8'));
      await this.pool.query(`INSERT INTO schema_migrations(filename) VALUES($1)`, [f]);
    }
  }
  private q = (text: string, vals?: unknown[]) => this.pool.query(text, vals as never[]);
  async getOrCreateUser(email: string) {
    const r = await this.q(`INSERT INTO users(email) VALUES($1) ON CONFLICT(email) DO UPDATE SET email=EXCLUDED.email RETURNING id,email,display_name,plan,stripe_customer_id`, [email]);
    return r.rows[0];
  }
  async getUser(id: string) { return (await this.q(`SELECT id,email,display_name,plan,stripe_customer_id FROM users WHERE id=$1`, [id])).rows[0] || null; }
  async setPlan(u: string, p: string, sc?: string) { await this.q(`UPDATE users SET plan=$2, stripe_customer_id=COALESCE($3,stripe_customer_id) WHERE id=$1`, [u, p, sc || null]); }
  async deleteUser(u: string) { await this.q(`DELETE FROM users WHERE id=$1`, [u]); }
  async insertTx(rows: Omit<Tx, 'id'>[]) {
    if (!rows.length) return 0;
    // M6: batch multi-row INSERTs instead of one query per row. Plaid rows still
    // dedupe on plaid_transaction_id. CSV rows are deduped count-aware in the import
    // handler (see txCounts), so they insert plainly — the old idx_tx_csv_dedup
    // unique index was dropped (migration 008) because it wrongly blocked
    // legitimate same-day identical purchases.
    const plaidRows = rows.filter(r => r.plaid_transaction_id);
    const csvRows = rows.filter(r => !r.plaid_transaction_id);
    let n = 0;
    n += await this.insertTxBatch(plaidRows, 'ON CONFLICT(plaid_transaction_id) DO NOTHING');
    n += await this.insertTxBatch(csvRows, '');
    return n;
  }
  private async insertTxBatch(rows: Omit<Tx, 'id'>[], conflict: string) {
    if (!rows.length) return 0;
    const CHUNK = 1000; // ~9k bound params/statement, well under pg's 65535 limit
    let n = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const vals: unknown[] = [];
      const tuples = chunk.map((r, j) => {
        const b = j * 11;
        vals.push(r.user_id, r.date, r.name, r.merchant, r.amount, r.balance, r.category, r.source, r.plaid_transaction_id || null, r.item_id || null, r.account || null);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
      });
      const res = await this.q(`INSERT INTO transactions(user_id,date,name,merchant,amount,balance,category,source,plaid_transaction_id,item_id,account)
                    VALUES ${tuples.join(',')} ${conflict}`, vals);
      n += res.rowCount || 0;
    }
    return n;
  }
  async allTx(u: string, from?: string) {
    const r = await this.q(`SELECT id,user_id,to_char(date,'YYYY-MM-DD') date,name,merchant,amount::float,balance::float,category,source,account,pinned,manual_refund FROM transactions WHERE user_id=$1 ${from ? 'AND date > $2' : ''} ORDER BY date`, from ? [u, from] : [u]);
    return r.rows;
  }
  async listTx(u: string, q2: { from?: string; to?: string; cat?: string; flow?: string; search?: string; limit: number; offset: number; sort: string; dir: string; accounts?: string[] }) {
    const sortCols: Record<string,string> = { date:'date', amount:'amount', name:'name', category:'category' };
    const conds = ['user_id=$1']; const vals: unknown[] = [u]; let i = 2;
    if (q2.from) { conds.push(`date > $${i++}`); vals.push(q2.from); }
    if (q2.to) { conds.push(`date <= $${i++}`); vals.push(q2.to); }
    if (q2.cat) { conds.push(`category = $${i++}`); vals.push(q2.cat); }
    if (q2.flow === 'in') conds.push('amount > 0');
    if (q2.flow === 'out') conds.push('amount < 0');
    if (q2.accounts?.length) { conds.push(`account = ANY($${i++})`); vals.push(q2.accounts); }
    if (q2.search) { conds.push(`(name ILIKE $${i} OR merchant ILIKE $${i})`); vals.push('%' + q2.search + '%'); i++; }
    const where = conds.join(' AND ');
    const total = +(await this.q(`SELECT count(*) c FROM transactions WHERE ${where}`, vals)).rows[0].c;
    const rows = (await this.q(`SELECT id,user_id,to_char(date,'YYYY-MM-DD') date,name,merchant,amount::float,balance::float,category,source,account,pinned,manual_refund FROM transactions WHERE ${where} ORDER BY ${sortCols[q2.sort]||'date'} ${q2.dir==='asc'?'ASC':'DESC'} LIMIT $${i} OFFSET $${i+1}`, [...vals, q2.limit, q2.offset])).rows;
    return { rows, total };
  }
  async txCounts(u: string) {
    const r = await this.q(`SELECT to_char(date,'YYYY-MM-DD')||'|'||amount::float||'|'||name k, count(*)::int c FROM transactions WHERE user_id=$1 GROUP BY 1`, [u]);
    return new Map<string, number>(r.rows.map((x: { k: string; c: number }) => [x.k, x.c]));
  }
  async setCategoryByMerchant(u: string, m: string, c: string) {
    const r = await this.q(`UPDATE transactions SET category=$3 WHERE user_id=$1 AND merchant=$2 AND amount<0`, [u, m, c]);
    return r.rowCount || 0;
  }
  async setTxCategories(u: string, updates: { id: string; category: string }[]) {
    if (!updates.length) return 0;
    let n = 0; const CHUNK = 500;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      const vals: unknown[] = []; const tuples = chunk.map((x, j) => { const b = j * 2; vals.push(x.id, x.category); return `($${b + 1}::uuid,$${b + 2})`; });
      const r = await this.q(`UPDATE transactions AS t SET category = v.cat FROM (VALUES ${tuples.join(',')}) AS v(id, cat) WHERE t.id = v.id AND t.user_id = $${vals.length + 1}`, [...vals, u]);
      n += r.rowCount || 0;
    }
    return n;
  }
  async pinTx(u: string, id: string, category: string): Promise<boolean> {
    const r = await this.q(`UPDATE transactions SET category=$3, pinned=true WHERE id=$2::uuid AND user_id=$1`, [u, id, category]);
    return (r.rowCount || 0) > 0;
  }
  async getOverrides(u: string) {
    const r = await this.q(`SELECT merchant_key,category FROM category_overrides WHERE user_id=$1`, [u]);
    return Object.fromEntries(r.rows.map((x: { merchant_key: string; category: string }) => [x.merchant_key, x.category]));
  }
  async setOverride(u: string, mk: string, c: string) {
    await this.q(`INSERT INTO category_overrides VALUES($1,$2,$3) ON CONFLICT(user_id,merchant_key) DO UPDATE SET category=$3`, [u, mk, c]);
  }
  async addItem(it: Omit<Item, 'id'>) {
    const r = await this.q(`INSERT INTO plaid_items(user_id,plaid_item_id,institution_name,access_token_ciphertext,sync_cursor,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [it.user_id, it.plaid_item_id, it.institution_name, it.access_token_ciphertext, it.sync_cursor, it.status]);
    return r.rows[0];
  }
  async listItems(u: string) { return (await this.q(`SELECT * FROM plaid_items WHERE user_id=$1`, [u])).rows; }
  async removeItem(u: string, id: string) { await this.q(`DELETE FROM plaid_items WHERE user_id=$1 AND id=$2`, [u, id]); }
  async countItems(u: string) { return +(await this.q(`SELECT count(*) c FROM plaid_items WHERE user_id=$1`, [u])).rows[0].c; }
  async setCursor(id: string, c: string) { await this.q(`UPDATE plaid_items SET sync_cursor=$2 WHERE id=$1`, [id, c]); }
  async setItemStatus(id: string, st: string) { await this.q(`UPDATE plaid_items SET status=$2 WHERE id=$1`, [id, st]); }
  async itemByPlaidId(pid: string) { return (await this.q(`SELECT * FROM plaid_items WHERE plaid_item_id=$1`, [pid])).rows[0] || null; }
  async upsertAccounts(rows: Omit<Account, 'id'>[]) {
    for (const r of rows)
      await this.q(`INSERT INTO accounts(item_id,user_id,plaid_account_id,name,mask,type,current_balance)
                    VALUES($1,$2,$3,$4,$5,$6,$7)
                    ON CONFLICT(plaid_account_id) DO UPDATE SET current_balance=EXCLUDED.current_balance, name=EXCLUDED.name`,
        [r.item_id, r.user_id, r.plaid_account_id, r.name, r.mask, r.type, r.current_balance]);
  }
  async listAccounts(u: string) { return (await this.q(`SELECT id,item_id,user_id,plaid_account_id,name,mask,type,current_balance::float FROM accounts WHERE user_id=$1`, [u])).rows; }
  async allItems() { return (await this.q(`SELECT * FROM plaid_items`)).rows; }
  async recordSnapshots(rows: Snapshot[]) {
    for (const r of rows)
      await this.q(`INSERT INTO account_balance_snapshots(account_id,user_id,date,balance) VALUES($1,$2,$3,$4)
                    ON CONFLICT(account_id,date) DO UPDATE SET balance=EXCLUDED.balance, captured_at=now()`,
        [r.account_id, r.user_id, r.date, r.balance]);
  }
  async listSnapshots(u: string, accountIds: string[]) {
    if (!accountIds.length) return [];
    return (await this.q(`SELECT account_id,user_id,to_char(date,'YYYY-MM-DD') date,balance::float FROM account_balance_snapshots WHERE user_id=$1 AND account_id = ANY($2::uuid[]) ORDER BY date`, [u, accountIds])).rows;
  }
  async upsertSubscription(sub: Subscription) {
    await this.q(`INSERT INTO subscriptions(user_id,stripe_subscription_id,plan,status,current_period_end) VALUES($1,$2,$3,$4,$5)
                  ON CONFLICT(user_id) DO UPDATE SET stripe_subscription_id=$2, plan=$3, status=$4, current_period_end=$5`,
      [sub.user_id, sub.stripe_subscription_id, sub.plan, sub.status, sub.current_period_end]);
  }
  async getSubscription(u: string) { return (await this.q(`SELECT * FROM subscriptions WHERE user_id=$1`, [u])).rows[0] || null; }
  async userByStripeCustomer(c: string) { return (await this.q(`SELECT id,email,display_name,plan,stripe_customer_id FROM users WHERE stripe_customer_id=$1`, [c])).rows[0] || null; }
  async getOrCreateUserBySub(sub: string, email: string) {
    const r = await this.q(`SELECT id,email,display_name,plan,stripe_customer_id FROM users WHERE entra_subject_id=$1`, [sub]);
    if (r.rows[0]) return r.rows[0];
    const u = await this.getOrCreateUser(email);
    await this.q(`UPDATE users SET entra_subject_id=$2 WHERE id=$1`, [u.id, sub]);
    return u;
  }
  async audit(u: string | null, e: string, d?: string, ipHash?: string) { await this.q(`INSERT INTO audit_log(user_id,event,detail,ip_hash) VALUES($1,$2,$3,$4)`, [u, e, d || null, ipHash || null]); }
}

export async function makeStore(): Promise<Store> {
  if (cfg.databaseUrl) {
    const s = new PgStore(cfg.databaseUrl);
    await s.migrate();
    console.log('store: postgres');
    return s;
  }
  console.log('store: in-memory (set DATABASE_URL for postgres)');
  return new MemStore();
}


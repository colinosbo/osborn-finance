// Data layer: PgStore for production (DATABASE_URL), MemStore for dev/tests.
import { randomUUID } from 'crypto';
import { cfg } from './config.js';

export interface User { id: string; email: string; display_name: string | null; plan: string; stripe_customer_id: string | null; }
export interface Tx { id: string; user_id: string; date: string; name: string; merchant: string; amount: number; balance: number | null; category: string; source: string; plaid_transaction_id?: string | null; }
export interface Item { id: string; user_id: string; plaid_item_id: string; institution_name: string; access_token_ciphertext: string; sync_cursor: string | null; status: string; }

export interface Store {
  getOrCreateUser(email: string): Promise<User>;
  getUser(id: string): Promise<User | null>;
  setPlan(userId: string, plan: string, stripeCustomerId?: string): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  insertTx(rows: Omit<Tx, 'id'>[]): Promise<number>;
  listTx(userId: string, q: { from?: string; cat?: string; flow?: string; search?: string; limit: number; offset: number; sort: string; dir: string }): Promise<{ rows: Tx[]; total: number }>;
  allTx(userId: string, from?: string): Promise<Tx[]>;
  txKeys(userId: string): Promise<Set<string>>;
  setCategoryByMerchant(userId: string, merchant: string, category: string): Promise<number>;
  getOverrides(userId: string): Promise<Record<string, string>>;
  setOverride(userId: string, merchantKey: string, category: string): Promise<void>;
  addItem(it: Omit<Item, 'id'>): Promise<Item>;
  listItems(userId: string): Promise<Item[]>;
  removeItem(userId: string, itemId: string): Promise<void>;
  countItems(userId: string): Promise<number>;
  setCursor(itemId: string, cursor: string): Promise<void>;
  audit(userId: string | null, event: string, detail?: string): Promise<void>;
}

/* ---------------- in-memory store ---------------- */
class MemStore implements Store {
  users = new Map<string, User>();
  tx = new Map<string, Tx[]>();
  overrides = new Map<string, Record<string, string>>();
  items = new Map<string, Item[]>();
  auditLog: Array<{ user_id: string | null; event: string; detail?: string; at: string }> = [];

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
  async listTx(userId: string, q: { from?: string; cat?: string; flow?: string; search?: string; limit: number; offset: number; sort: string; dir: string }) {
    let rows = await this.allTx(userId, q.from);
    if (q.cat) rows = rows.filter(t => t.category === q.cat);
    if (q.flow === 'in') rows = rows.filter(t => t.amount > 0);
    if (q.flow === 'out') rows = rows.filter(t => t.amount < 0);
    if (q.search) { const s = q.search.toLowerCase(); rows = rows.filter(t => t.name.toLowerCase().includes(s) || t.merchant.toLowerCase().includes(s)); }
    const k = q.sort as keyof Tx, dir = q.dir === 'asc' ? 1 : -1;
    rows.sort((a, b) => ((a[k] ?? '') < (b[k] ?? '') ? -1 : 1) * dir);
    return { rows: rows.slice(q.offset, q.offset + q.limit), total: rows.length };
  }
  async txKeys(userId: string) {
    return new Set((this.tx.get(userId) || []).map(t => `${t.date}|${t.amount}|${t.name}`));
  }
  async setCategoryByMerchant(userId: string, merchant: string, category: string) {
    let n = 0;
    for (const t of this.tx.get(userId) || []) if (t.merchant === merchant && t.amount < 0) { t.category = category; n++; }
    return n;
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
  }
  async countItems(userId: string) { return (this.items.get(userId) || []).length; }
  async setCursor(itemId: string, cursor: string) {
    for (const list of this.items.values()) for (const i of list) if (i.id === itemId) i.sync_cursor = cursor;
  }
  async audit(user_id: string | null, event: string, detail?: string) {
    this.auditLog.push({ user_id, event, detail, at: new Date().toISOString() });
  }
}

/* ---------------- postgres store ---------------- */
import pg from 'pg';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

class PgStore implements Store {
  pool: pg.Pool;
  constructor(url: string) { this.pool = new pg.Pool({ connectionString: url }); }
  async migrate() {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
    for (const f of readdirSync(dir).sort()) await this.pool.query(readFileSync(join(dir, f), 'utf8'));
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
    for (const r of rows)
      await this.q(`INSERT INTO transactions(user_id,date,name,merchant,amount,balance,category,source,plaid_transaction_id)
                    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(plaid_transaction_id) DO NOTHING`,
        [r.user_id, r.date, r.name, r.merchant, r.amount, r.balance, r.category, r.source, r.plaid_transaction_id || null]);
    return rows.length;
  }
  async allTx(u: string, from?: string) {
    const r = await this.q(`SELECT id,user_id,to_char(date,'YYYY-MM-DD') date,name,merchant,amount::float,balance::float,category,source FROM transactions WHERE user_id=$1 ${from ? 'AND date > $2' : ''} ORDER BY date`, from ? [u, from] : [u]);
    return r.rows;
  }
  async listTx(u: string, q2: { from?: string; cat?: string; flow?: string; search?: string; limit: number; offset: number; sort: string; dir: string }) {
    const sortCols: Record<string,string> = { date:'date', amount:'amount', name:'name', category:'category' };
    const conds = ['user_id=$1']; const vals: unknown[] = [u]; let i = 2;
    if (q2.from) { conds.push(`date > $${i++}`); vals.push(q2.from); }
    if (q2.cat) { conds.push(`category = $${i++}`); vals.push(q2.cat); }
    if (q2.flow === 'in') conds.push('amount > 0');
    if (q2.flow === 'out') conds.push('amount < 0');
    if (q2.search) { conds.push(`(name ILIKE $${i} OR merchant ILIKE $${i})`); vals.push('%' + q2.search + '%'); i++; }
    const where = conds.join(' AND ');
    const total = +(await this.q(`SELECT count(*) c FROM transactions WHERE ${where}`, vals)).rows[0].c;
    const rows = (await this.q(`SELECT id,user_id,to_char(date,'YYYY-MM-DD') date,name,merchant,amount::float,balance::float,category,source FROM transactions WHERE ${where} ORDER BY ${sortCols[q2.sort]||'date'} ${q2.dir==='asc'?'ASC':'DESC'} LIMIT $${i} OFFSET $${i+1}`, [...vals, q2.limit, q2.offset])).rows;
    return { rows, total };
  }
  async txKeys(u: string) {
    const r = await this.q(`SELECT to_char(date,'YYYY-MM-DD')||'|'||amount::float||'|'||name k FROM transactions WHERE user_id=$1`, [u]);
    return new Set<string>(r.rows.map((x: { k: string }) => x.k));
  }
  async setCategoryByMerchant(u: string, m: string, c: string) {
    const r = await this.q(`UPDATE transactions SET category=$3 WHERE user_id=$1 AND merchant=$2 AND amount<0`, [u, m, c]);
    return r.rowCount || 0;
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
  async audit(u: string | null, e: string, d?: string) { await this.q(`INSERT INTO audit_log(user_id,event,detail) VALUES($1,$2,$3)`, [u, e, d || null]); }
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

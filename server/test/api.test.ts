import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { buildApp } from '../src/index.js';
import { makeStore } from '../src/store.js';
import type { Express } from 'express';

const csv = readFileSync(new URL('./demo_data.csv', import.meta.url), 'utf8');
let app: Express;
const H = { 'x-user-email': 'test@osborn.dev' };

async function call(method: string, path: string, body?: unknown, type = 'application/json') {
  const srv = app.listen(0);
  const port = (srv.address() as { port: number }).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { ...H, 'Content-Type': type },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const json = await res.json();
  srv.close();
  return { status: res.status, json };
}

beforeAll(async () => { app = await buildApp(await makeStore()); });

describe('Osborn Finance API (mock mode)', () => {
  it('health: mock plaid + stripe, in-memory db', async () => {
    const r = await call('GET', '/api/health');
    expect(r.json.mode).toEqual({ db: false, plaid: 'mock', stripe: 'mock' });
  });
  it('imports the 458-row demo CSV with exact totals', async () => {
    const r = await call('POST', '/api/import/csv', csv, 'text/csv');
    expect(r.json.imported).toBe(458);
    const s = await call('GET', '/api/summary?days=0');
    expect(s.json.income).toBeCloseTo(37823.19, 2);
    expect(s.json.spend).toBeCloseTo(35311.32, 2);
    expect(s.json.categories.find((c: {name:string}) => c.name === 'Rent & Housing').total).toBe(13800);
    expect((s.json.categories.find((c: {name:string}) => c.name === 'Other')?.total || 0)).toBe(0);
  });
  it('re-import is fully deduplicated', async () => {
    const r = await call('POST', '/api/import/csv', csv, 'text/csv');
    expect(r.json.imported).toBe(0);
    expect(r.json.duplicates).toBe(458);
  });
  it('ledger pagination + filters', async () => {
    const r = await call('GET', '/api/transactions?limit=25&days=365&flow=out');
    expect(r.json.rows.length).toBe(25);
    expect(r.json.total).toBeGreaterThan(300);
    expect(r.json.rows.every((t: {amount:number}) => t.amount < 0)).toBe(true);
  });
  it('recategorize creates an override and updates rows', async () => {
    const r = await call('POST', '/api/transactions/recategorize', { merchant: 'Starbucks', category: 'Entertainment' });
    expect(r.json.updated).toBeGreaterThan(0);
    const l = await call('GET', '/api/transactions?q=starbucks&limit=5');
    expect(l.json.rows[0].category).toBe('Entertainment');
  });
  it('advisor returns pinned headline + tips with savings math', async () => {
    const r = await call('GET', '/api/advisor?days=365');
    expect(r.json.tips.length).toBeGreaterThan(3);
    expect(r.json.tips[0].title).toMatch(/savings|spent more|margin/i);
    expect(r.json.totalSavePerMonth).toBeGreaterThan(0);
  });
  it('plan gate: free tier cannot link a bank (402 upgrade)', async () => {
    const r = await call('POST', '/api/plaid/link-token');
    expect(r.status).toBe(402);
    expect(r.json.upgrade).toBe(true);
  });
  it('checkout (mock) activates plan, then plaid link + exchange + sync works', async () => {
    const c = await call('POST', '/api/billing/checkout', { plan: 'personal' });
    expect(c.json.url).toContain('mock-checkout');
    const lt = await call('POST', '/api/plaid/link-token');
    expect(lt.json.link_token).toContain('link-mock');
    const ex = await call('POST', '/api/plaid/exchange', { public_token: 'public-mock-1' });
    expect(ex.json.imported).toBeGreaterThan(0);
    const me = await call('GET', '/api/me');
    expect(me.json.plan).toBe('personal');
    expect(me.json.items.length).toBe(1);
  });
  it('plan limit enforced after first item on personal', async () => {
    const r = await call('POST', '/api/plaid/link-token');
    expect(r.status).toBe(402);
  });
  it('data export + account deletion', async () => {
    const e = await call('GET', '/api/me/export');
    expect(e.json.transactions.length).toBeGreaterThan(458);
    const d = await call('DELETE', '/api/me');
    expect(d.json.deleted).toBe(true);
  });
});

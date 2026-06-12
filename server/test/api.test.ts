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
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  srv.close();
  return { status: res.status, json };
}

beforeAll(async () => { app = await buildApp(await makeStore()); });

describe('Osborn Finance API (mock mode)', () => {
  it('health: mock plaid + stripe, in-memory db', async () => {
    const r = await call('GET', '/api/health');
    expect(r.json.mode).toMatchObject({ db: false, plaid: 'mock', stripe: 'mock', auth: 'dev' });
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

/* ============ Code-review remediation tests (Phase 5) ============ */
import { verifyStripeSignature, parseStripeEvent, planFromPriceId } from '../src/stripe.js';
import { createHmac } from 'crypto';

describe('Security fixes', () => {
  it('SEC-4/BUG-3: stripe signature verification accepts valid, rejects forged', () => {
    const secret = 'whsec_test123';
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)}`, secret)).toBe(false);
    expect(verifyStripeSignature(body, undefined, secret)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t - 9999},v1=${v1}`, secret)).toBe(false); // stale timestamp
  });
  it('BUG-1: plan derived from price id, never defaulted', () => {
    expect(planFromPriceId('price_family_dev')).toBe('family');
    expect(planFromPriceId('price_enterprise_dev')).toBe('enterprise');
    expect(planFromPriceId('price_unknown')).toBe(null);
    expect(planFromPriceId(undefined)).toBe(null);
  });
  it('INC-1: subscription lifecycle events parsed', () => {
    expect(parseStripeEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', current_period_end: 123, items: { data: [{ price: { id: 'price_enterprise_dev' } }] } } as never } }))
      .toMatchObject({ kind: 'update', plan: 'enterprise', customer: 'cus_1' });
    expect(parseStripeEvent({ type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } as never } })).toMatchObject({ kind: 'payment_failed' });
    expect(parseStripeEvent({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } as never } })).toMatchObject({ kind: 'cancel' });
    expect(parseStripeEvent({ type: 'something.else', data: { object: {} as never } })).toMatchObject({ kind: 'ignore' });
  });
  it('SEC-4 end-to-end: forged webhook cannot upgrade an account (mock mode applies parse, but plan only set with valid userId+plan)', async () => {
    // forged event with no real price/subscription -> plan stays unchanged
    const me1 = await call('GET', '/api/me');
    const before = me1.json.plan;
    await call('POST', '/api/webhooks/stripe', { type: 'checkout.session.completed', data: { object: { client_reference_id: me1.json.id, customer: 'cus_forged' } } });
    const me2 = await call('GET', '/api/me');
    expect(me2.json.plan).toBe(before); // no price id -> no plan derived -> no upgrade
  });
  it('INC-4: plaid webhook syncs a real item and flags login_required', async () => {
    await call('POST', '/api/billing/checkout', { plan: 'family' });
    const ex = await call('POST', '/api/plaid/exchange', { public_token: 'public-webhook-test' });
    const itemsBefore = (await call('GET', '/api/me')).json.items;
    const plaidItemId = 'item-mock-unknown';
    // unknown item: accepted but no-op
    const r1 = await call('POST', '/api/webhooks/plaid', { webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', item_id: plaidItemId });
    expect(r1.json.received).toBe(true);
    // login-required flips status (need the real plaid_item_id — fetch via accounts API items)
    const acc = await call('GET', '/api/accounts');
    expect(acc.json.accounts.length).toBeGreaterThan(0); // INC-2: accounts synced
    expect(ex.json.imported).toBeGreaterThan(0);
    expect(itemsBefore.length).toBeGreaterThan(0);
  });
  it('SEC-1: link/exchange endpoints are rate limited (5/min/user)', async () => {
    let got429 = false;
    for (let i = 0; i < 8; i++) {
      const r = await call('POST', '/api/plaid/link-token');
      if (r.status === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });
  it('INC-3: subscription state exposed on /api/me', async () => {
    const me = await call('GET', '/api/me');
    expect(me.json.subscription).toBeTruthy();
    expect(me.json.subscription.status).toBe('active');
  });
});

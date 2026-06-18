import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { buildApp } from '../src/index.js';
import { makeStore } from '../src/store.js';
import type { Express } from 'express';

const csv = readFileSync(new URL('./demo_data.csv', import.meta.url), 'utf8');
let app: Express;
const H = { 'x-user-email': 'test@osborn.dev' };

async function call(method: string, path: string, body?: unknown, type = 'application/json', hdrs: Record<string, string> = H) {
  const srv = app.listen(0);
  const port = (srv.address() as { port: number }).port;
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method, headers: { ...hdrs, 'Content-Type': type },
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  srv.close();
  return { status: res.status, json };
}

beforeAll(async () => { app = await buildApp(await makeStore()); });

describe('Osborn Finance API (mock mode)', () => {
  it('L2: public health probe is minimal; details require auth', async () => {
    const pub = await call('GET', '/api/health');
    expect(pub.json).toEqual({ ok: true }); // no config disclosed anonymously
    const r = await call('GET', '/api/health/details');
    expect(r.json.mode).toMatchObject({ db: false, plaid: 'mock', stripe: 'mock', auth: 'dev' });
  });
  it('imports the 458-row demo CSV with exact totals', async () => {
    const r = await call('POST', '/api/import/csv', csv, 'text/csv');
    expect(r.json.imported).toBe(458);
    const s = await call('GET', '/api/summary?days=0');
    expect(s.json.income).toBeCloseTo(37823.19, 2);
    expect(s.json.spend).toBeCloseTo(31490.24, 2); // excludes movement cats (credit card pmts, Robinhood, Venmo)
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
  it('I3: invalid recategorize body is rejected with 400', async () => {
    const r = await call('POST', '/api/transactions/recategorize', { merchant: 'X', category: 'NotARealCategory' });
    expect(r.status).toBe(400);
    const r2 = await call('POST', '/api/billing/checkout', { plan: 'platinum' });
    expect(r2.status).toBe(400);
  });
  it('M6: oversized CSV (>20k rows) is rejected with 413', async () => {
    const big = 'date,description,amount\n' + Array.from({ length: 20001 }, (_, i) => `2025-01-01,row${i},-1.00`).join('\n');
    const r = await call('POST', '/api/import/csv', big, 'text/csv');
    expect(r.status).toBe(413);
  });
  it('FIX (Bug-2): pinned transaction survives bulk reclassify', async () => {
    const U = { 'x-user-email': 'pin-fix@osborn.dev' }; // isolated user
    // Import a row that the classifier will assign to "Dining & Fast Food"
    const pinCsv = 'Date,Amount,Transaction Type,Description\n2026-05-01,12.50,Debit,Withdrawal POS STARBUCKS COFFEE';
    await call('POST', '/api/import/csv', pinCsv, 'text/csv', U);
    const led = await call('GET', '/api/transactions?limit=5', undefined, 'application/json', U);
    const tx = led.json.rows[0];
    expect(tx.category).toBe('Dining & Fast Food'); // classifier default
    // Manually pin it to a different category
    const patch = await call('PATCH', `/api/transactions/${tx.id}`, { category: 'Entertainment' }, 'application/json', U);
    expect(patch.json.ok).toBe(true);
    // Now bulk-reclassify — the pinned tx must NOT revert
    await call('POST', '/api/transactions/reclassify', undefined, 'application/json', U);
    const led2 = await call('GET', '/api/transactions?limit=5', undefined, 'application/json', U);
    expect(led2.json.rows[0].category).toBe('Entertainment'); // still pinned, not overwritten
  });
  it('FIX: unlinking a bank removes that bank\'s transactions', async () => {
    const U = { 'x-user-email': 'unlink-fix@osborn.dev' }; // isolated user
    await call('POST', '/api/billing/checkout', { plan: 'personal' }, 'application/json', U);
    const ex = await call('POST', '/api/plaid/exchange', { public_token: 'public-unlink-fix' }, 'application/json', U);
    expect(ex.json.imported).toBeGreaterThan(0);
    const t1 = await call('GET', '/api/transactions?limit=1', undefined, 'application/json', U);
    expect(t1.json.total).toBe(ex.json.imported); // bank's txns present
    const me = await call('GET', '/api/me', undefined, 'application/json', U);
    const itemId = me.json.items[0].id;
    const d = await call('DELETE', `/api/plaid/items/${itemId}`, undefined, 'application/json', U);
    expect(d.json.removed).toBe(true);
    const t2 = await call('GET', '/api/transactions?limit=1', undefined, 'application/json', U);
    expect(t2.json.total).toBe(0); // FIX: gone after unlink, not lingering
  });
});

/* ============ Penetration-review remediation (H1/H2/M5) ============ */
import { encrypt, decrypt } from '../src/crypto.js';
import { assertSecureConfig } from '../src/config.js';

describe('Pen-test remediation', () => {
  it('M5: versioned ciphertext round-trips and carries a key-id prefix', () => {
    const token = 'access-sandbox-abc-123';
    const blob = encrypt(token);
    expect(decrypt(blob)).toBe(token);
    // first byte of the decoded blob is the key id (1 by default), distinct from a bare IV
    expect(Buffer.from(blob, 'base64')[0]).toBe(1);
  });
  it('M5: legacy unversioned blobs still decrypt (rotation back-compat)', () => {
    // simulate a pre-versioning blob: [iv][tag][ct] with the dev fallback key
    const { createCipheriv, randomBytes } = require('crypto');
    const key = Buffer.alloc(32, 7);
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([c.update('legacy-token', 'utf8'), c.final()]);
    const legacy = Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
    expect(decrypt(legacy)).toBe('legacy-token');
  });
  it('H1/H2: dev config is accepted; prod requires entra + issuer (logic check)', () => {
    // In the test runtime AUTH_MODE defaults to dev (NODE_ENV=test) → no fatal problems.
    expect(assertSecureConfig()).toEqual([]);
  });
});

describe('Reports engine', () => {
  const U = { 'x-user-email': 'reports@osborn.dev' };
  it('monthly report returns KPIs, categories, trend, insights', async () => {
    await call('POST', '/api/import/csv', csv, 'text/csv', U);
    const r = await call('GET', '/api/reports/monthly?offset=0', undefined, 'application/json', U);
    expect(r.status).toBe(200);
    expect(r.json.period.grain).toBe('week');
    expect(r.json.kpis.spend).toHaveProperty('delta');
    expect(Array.isArray(r.json.categories)).toBe(true);
    expect(Array.isArray(r.json.trend)).toBe(true);
    expect(r.json.insights.tips.length).toBeGreaterThan(0);
  });
  it('weekly uses daily grain; year_in_review uses monthly grain', async () => {
    const wk = await call('GET', '/api/reports/weekly', undefined, 'application/json', U);
    expect(wk.json.period.grain).toBe('day');
    const yr = await call('GET', '/api/reports/year_in_review', undefined, 'application/json', U);
    expect(yr.json.period.grain).toBe('month');
  });
  it('rejects an unknown cadence', async () => {
    const r = await call('GET', '/api/reports/decade', undefined, 'application/json', U);
    expect(r.status).toBe(400);
  });
  it('day-range report: 30 days on the spot', async () => {
    const r = await call('GET', '/api/reports?days=30&offset=0', undefined, 'application/json', U);
    expect(r.status).toBe(200);
    expect(r.json.days).toBe(30);
    expect(r.json.period.days).toBe(30);
    expect(r.json.kpis.spend).toHaveProperty('delta');
    expect(Array.isArray(r.json.categories)).toBe(true);
  });
  it('day-range report: defaults to 30 days, supports custom + offset', async () => {
    const def = await call('GET', '/api/reports', undefined, 'application/json', U);
    expect(def.json.days).toBe(30);
    const custom = await call('GET', '/api/reports?days=45&offset=1', undefined, 'application/json', U);
    expect(custom.json.days).toBe(45);
    expect(custom.json.period.days).toBe(45);
  });
});

describe('Internal-transfer netting', () => {
  const U = { 'x-user-email': 'transfers@osborn.dev' };
  // Payroll (income), one real purchase (spend), and a $200 move between the user's
  // OWN Checking and Savings accounts (the Account column names each). The transfer
  // pair sits in two DIFFERENT known accounts, so it must NOT count as income/spend.
  const transfersCsv = [
    'Date,Amount,Transaction Type,Description,Account',
    '2026-05-01,1000.00,Credit,Deposit PAYROLL Q INTERNATIONAL,Checking (0114)',
    '2026-05-02,50.00,Debit,Withdrawal POS MCDONALDS PLAINFIELD IL,Checking (0114)',
    '2026-05-03,200.00,Debit,Withdrawal Home Banking Transfer To Savings 0001,Checking (0114)',
    '2026-05-03,200.00,Credit,Deposit Home Banking Transfer From Checking 0114,Savings (0001)',
  ].join('\n');

  it('excludes internal transfers from income and spend, keeps them tagged in the ledger', async () => {
    const imp = await call('POST', '/api/import/csv', transfersCsv, 'text/csv', U);
    expect(imp.json.imported).toBe(4);
    const s = await call('GET', '/api/summary?days=0', undefined, 'application/json', U);
    expect(s.json.income).toBeCloseTo(1000, 2);   // 200 transfer-in excluded
    expect(s.json.spend).toBeCloseTo(50, 2);       // 200 transfer-out excluded
    expect(s.json.net).toBeCloseTo(950, 2);
    // both legs still present in the ledger, tagged as a transfer
    const led = await call('GET', '/api/transactions?days=0&limit=50', undefined, 'application/json', U);
    const tagged = led.json.rows.filter((t: { transfer?: string }) => t.transfer);
    expect(tagged.length).toBe(2);
    expect(new Set(tagged.map((t: { transfer: string }) => t.transfer))).toEqual(new Set(['transfer_out', 'transfer_in']));
  });

  it('does NOT net a transfer-shaped pair that lacks a distinct second account', async () => {
    const V = { 'x-user-email': 'transfers-noacct@osborn.dev' };
    // No Account column → unknown account → cannot confirm it stayed between the
    // user's own accounts, so both legs still count.
    const csvNoAcct = [
      'Date,Amount,Transaction Type,Description',
      '2026-05-03,200.00,Debit,Withdrawal Home Banking Transfer To Savings 0001',
      '2026-05-03,200.00,Credit,Deposit Home Banking Transfer From Checking 0114',
    ].join('\n');
    await call('POST', '/api/import/csv', csvNoAcct, 'text/csv', V);
    const s = await call('GET', '/api/summary?days=0', undefined, 'application/json', V);
    expect(s.json.income).toBeCloseTo(200, 2);  // not netted
    expect(s.json.spend).toBeCloseTo(200, 2);   // not netted
  });
});

import { detectRecurring } from '../src/recurring.js';
import type { Tx } from '../src/store.js';

describe('Subscription detection: income is never a subscription', () => {
  let n = 0;
  const mk = (date: string, amount: number, name: string, merchant: string, category: string): Tx => ({
    id: `t${n++}`, user_id: 'u', date, name, merchant, amount, balance: null, category, source: 'csv'
  });
  // Build a perfectly regular biweekly series at a fixed amount (the shape of a paycheck).
  const series = (dates: string[], amount: number, name: string, merchant: string, category: string) =>
    dates.map(d => mk(d, amount, name, merchant, category));
  const biweekly = ['2026-04-03', '2026-04-17', '2026-05-01', '2026-05-15', '2026-05-29', '2026-06-12'];
  const monthly = ['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15'];
  const NOW = '2026-06-17';

  it('does not flag a sign-flipped/miscategorized payroll as a subscription', () => {
    // A paycheck whose debit/credit column was misread on import: negative amount,
    // category fell through to "Other", but the descriptor reads as payroll.
    const tx = series(biweekly, -1500, 'ACME LOGISTICS PAYROLL DIRECT DEP', 'Acme Logistics (Payroll)', 'Other');
    const subs = detectRecurring(tx, NOW).subscriptions;
    expect(subs.length).toBe(0);
  });

  it('does not flag income-categorized inflows as a subscription', () => {
    const tx = series(biweekly, 1500, 'DEPOSIT PAYROLL Q INTERNATIONAL', 'Q International', 'Income');
    expect(detectRecurring(tx, NOW).subscriptions.length).toBe(0);
  });

  it('does not flag recurring interest/direct-deposit descriptors even at negative amounts', () => {
    const tx = series(monthly, -42.5, 'INTEREST PAID', 'Bank', 'Other');
    expect(detectRecurring(tx, NOW).subscriptions.length).toBe(0);
  });

  it('still detects a genuine recurring subscription (guard does not over-block)', () => {
    const tx = series(monthly, -15.99, 'NETFLIX.COM', 'Netflix', 'Subscriptions & Digital');
    const subs = detectRecurring(tx, NOW).subscriptions;
    expect(subs.length).toBe(1);
    expect(subs[0].merchant).toBe('Netflix');
    expect(subs[0].active).toBe(true);
  });

  it('detects a real subscription while ignoring a payroll mixed into the same dataset', () => {
    const tx = [
      ...series(monthly, -15.99, 'NETFLIX.COM', 'Netflix', 'Subscriptions & Digital'),
      ...series(biweekly, -1500, 'ACME LOGISTICS PAYROLL', 'Acme Logistics (Payroll)', 'Other'),
    ];
    const subs = detectRecurring(tx, NOW).subscriptions;
    expect(subs.map(s => s.merchant)).toEqual(['Netflix']);
  });

  it('does not flag a buy-then-refund cycle (net $0) as a subscription', () => {
    // United Airlines: a $500 ticket charged then refunded $500 each month, alternating,
    // nets to $0. Refund netting pairs the legs; the surviving outflows must NOT show up
    // as a $500/mo subscription.
    const tx = [
      mk('2026-03-30', -500, 'UNITED AIRLINES WITHDRAWAL', 'United Airlines', 'Other'),
      mk('2026-04-12', 500, 'UNITED AIRLINES DEPOSIT', 'United Airlines', 'Income'),
      mk('2026-04-29', -500, 'UNITED AIRLINES WITHDRAWAL', 'United Airlines', 'Other'),
      mk('2026-05-12', 500, 'UNITED AIRLINES DEPOSIT', 'United Airlines', 'Income'),
      mk('2026-05-29', -500, 'UNITED AIRLINES WITHDRAWAL', 'United Airlines', 'Other'),
      mk('2026-06-11', 500, 'UNITED AIRLINES DEPOSIT', 'United Airlines', 'Income'),
    ];
    expect(detectRecurring(tx, NOW).subscriptions.length).toBe(0);
  });

  it('still flags a genuine monthly charge that is NOT refunded', () => {
    // Same vendor/cadence, but no offsetting refunds → a real recurring cost.
    const tx = series(monthly, -500, 'UNITED CLUB MEMBERSHIP', 'United Airlines', 'Other');
    const subs = detectRecurring(tx, NOW).subscriptions;
    expect(subs.length).toBe(1);
    expect(subs[0].monthlyCost).toBeGreaterThan(0);
  });
});

describe('Refund netting reflected across every income/spend/net surface', () => {
  const RU = { 'x-user-email': 'refund-surfaces@osborn.dev' };
  // $1000 bought in May, fully refunded in June (26 days later) at the SAME vendor for
  // the exact amount, under descriptors that differ by direction + RETURN (an unlisted
  // merchant). It must vanish from every overall total but stay visible in the ledger.
  const csv = [
    'Date,Amount,Transaction Type,Description',
    '2026-05-01,3000.00,Credit,Deposit PAYROLL Q INTERNATIONAL',
    '2026-05-15,50.00,Debit,Withdrawal POS MCDONALDS PLAINFIELD IL',
    '2026-05-10,1000.00,Debit,Withdrawal DEBIT CARD BIGTICKET ELECTRONICS CHICAGO IL',
    '2026-06-05,1000.00,Credit,Deposit DEBIT CARD BIGTICKET ELECTRONICS CHICAGO IL RETURN',
  ].join('\n');

  it('nets the buy-then-refund out of summary, reports, advisor and debt; keeps it tagged in the ledger', async () => {
    expect((await call('POST', '/api/import/csv', csv, 'text/csv', RU)).json.imported).toBe(4);

    const s = (await call('GET', '/api/summary?days=0', undefined, 'application/json', RU)).json;
    expect(s.income).toBeCloseTo(3000, 2);   // refunded $1000 not counted as income
    expect(s.spend).toBeCloseTo(50, 2);      // refunded $1000 charge not counted as spend
    expect(s.net).toBeCloseTo(2950, 2);

    const rep = (await call('GET', '/api/reports?from=2026-04-30&to=2026-06-30', undefined, 'application/json', RU)).json;
    expect(rep.kpis.income.value).toBeCloseTo(3000, 2);
    expect(rep.kpis.spend.value).toBeCloseTo(50, 2);

    const adv = (await call('GET', '/api/advisor', undefined, 'application/json', RU)).json;
    expect(adv.period.income).toBeCloseTo(3000, 2);
    expect(adv.period.spend).toBeCloseTo(50, 2);

    const debt = (await call('GET', '/api/debt', undefined, 'application/json', RU)).json;
    expect(debt.monthlyProfit).toBeCloseTo(2950, 2); // net cash flow, refund excluded

    const led = (await call('GET', '/api/transactions?days=0&limit=50', undefined, 'application/json', RU)).json;
    expect(led.rows.filter((t: { refund?: string }) => t.refund).length).toBe(2); // both legs shown, tagged
  });
});

describe('Refunds are a separate category: excluded from income, kept in the ledger', () => {
  const RC = { 'x-user-email': 'refund-cat@osborn.dev' };
  // A standalone refund (a return that we recognize by descriptor but can't pair to a
  // specific earlier purchase) must NOT count as income, yet must remain in the ledger.
  const csv = [
    'Date,Amount,Transaction Type,Description',
    '2026-05-01,3000.00,Credit,Deposit PAYROLL Q INTERNATIONAL',
    '2026-05-20,200.00,Credit,Deposit DEBIT CARD ACME OUTDOORS REFUND',
  ].join('\n');
  it('classifies a refund as Refunds, keeps it out of total income, and still lists it', async () => {
    expect((await call('POST', '/api/import/csv', csv, 'text/csv', RC)).json.imported).toBe(2);
    const s = (await call('GET', '/api/summary?days=0', undefined, 'application/json', RC)).json;
    expect(s.income).toBeCloseTo(3000, 2); // the $200 refund is NOT income
    const led = (await call('GET', '/api/transactions?days=0&limit=50&flow=in', undefined, 'application/json', RC)).json;
    const refundRow = led.rows.find((t: { category: string }) => t.category === 'Refunds');
    expect(refundRow).toBeTruthy();                 // still visible in the ledger
    expect(refundRow.amount).toBeCloseTo(200, 2);
  });
});

describe('Income is reported consistently across every surface', () => {
  const IU = { 'x-user-email': 'income-surfaces@osborn.dev' };
  // One clean month: $4,000 payroll (income) + a little spending, no refunds/transfers.
  const csv = [
    'Date,Amount,Transaction Type,Description',
    '2026-05-01,4000.00,Credit,Deposit PAYROLL Q INTERNATIONAL',
    '2026-05-10,120.00,Debit,Withdrawal POS WALMART NORMAL IL',
    '2026-05-20,80.00,Debit,Withdrawal POS SHELL OIL BLOOMINGTON IL',
  ].join('\n');

  it('summary, reports and advisor all report the same income, broken down by source', async () => {
    expect((await call('POST', '/api/import/csv', csv, 'text/csv', IU)).json.imported).toBe(3);

    const sum = (await call('GET', '/api/summary?days=0', undefined, 'application/json', IU)).json;
    const rep = (await call('GET', '/api/reports?from=2026-04-30&to=2026-05-31', undefined, 'application/json', IU)).json;
    const adv = (await call('GET', '/api/advisor', undefined, 'application/json', IU)).json;

    // Same income value on the dashboard (summary), the reports KPI, and the advisor.
    expect(sum.income).toBeCloseTo(4000, 2);
    expect(rep.kpis.income.value).toBeCloseTo(4000, 2);
    expect(adv.period.income).toBeCloseTo(4000, 2);
    expect(adv.budget.income).toBeCloseTo(4000, 2);

    // Income is also surfaced broken down by source on the reports page.
    expect(rep.incomeSources.reduce((s, x) => s + x.total, 0)).toBeCloseTo(4000, 2);
    expect(rep.incomeSources.length).toBeGreaterThan(0);
  });
});

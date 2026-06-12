import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cfg, PLAN_LIMITS } from './config.js';
import { makeStore, type Store, type User } from './store.js';
import { classify, merchant, cleanDesc, ALL_CATS } from './classifier.js';
import { parseCSV, autoMap, parseDateStr, parseAmtStr } from './csv.js';
import { summarize, advise } from './analytics.js';
import { Plaid, runItemSync, encryptToken, verifyPlaidWebhook } from './plaid.js';
import { Billing, PLAN_PRICES, parseStripeEvent, verifyStripeSignature, fetchSubscriptionPlan } from './stripe.js';
import { decrypt } from './crypto.js';

export async function buildApp(store: Store) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: cfg.appBaseUrl }));
  app.use(rateLimit({ windowMs: 60_000, max: 300 }));

  /* ================= WEBHOOKS =================
     Registered BEFORE express.json() so handlers receive the RAW body —
     required for HMAC/JWT signature verification (BUG-3, SEC-3, SEC-4). */

  app.post('/api/webhooks/stripe', express.raw({ type: '*/*' }), async (req, res) => {
    const raw: Buffer = req.body;
    if (!cfg.stripe.mock) {
      // SEC-4: only Stripe (holder of the webhook secret) can produce this signature.
      if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string, cfg.stripe.webhookSecret))
        return res.status(400).json({ error: 'invalid signature' });
    }
    let evt;
    try { evt = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'invalid JSON' }); }
    const action = parseStripeEvent(evt);
    try {
      if (action.kind === 'activate' && action.userId) {
        // BUG-1: derive plan from the subscription's price id (session events don't carry it).
        let plan = action.plan, periodEnd: number | null = null;
        if (!plan && action.subscriptionId) {
          const s = await fetchSubscriptionPlan(action.subscriptionId);
          plan = s.plan; periodEnd = s.currentPeriodEnd;
        }
        if (plan) {
          await store.setPlan(action.userId, plan, action.customer);
          await store.upsertSubscription({ user_id: action.userId, stripe_subscription_id: action.subscriptionId || null, plan, status: 'active', current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null });
          await store.audit(action.userId, 'plan_activated', plan);
        }
      } else if (action.kind === 'update' && action.customer) {
        const u = await store.userByStripeCustomer(action.customer);
        if (u && action.plan) {
          await store.setPlan(u.id, action.plan);
          await store.upsertSubscription({ user_id: u.id, stripe_subscription_id: action.subscriptionId || null, plan: action.plan, status: 'active', current_period_end: action.currentPeriodEnd ? new Date(action.currentPeriodEnd * 1000).toISOString() : null });
          await store.audit(u.id, 'plan_updated', action.plan);
        }
      } else if (action.kind === 'cancel' && action.customer) {
        const u = await store.userByStripeCustomer(action.customer);
        if (u) {
          await store.setPlan(u.id, 'free');
          await store.upsertSubscription({ user_id: u.id, stripe_subscription_id: action.subscriptionId || null, plan: 'free', status: 'canceled', current_period_end: null });
          await store.audit(u.id, 'plan_canceled');
        }
      } else if (action.kind === 'payment_failed' && action.customer) {
        // INC-1: flag the account; Stripe Smart Retries run before subscription.deleted fires.
        const u = await store.userByStripeCustomer(action.customer);
        if (u) {
          const sub = await store.getSubscription(u.id);
          await store.upsertSubscription({ user_id: u.id, stripe_subscription_id: sub?.stripe_subscription_id || null, plan: u.plan, status: 'past_due', current_period_end: sub?.current_period_end || null });
          await store.audit(u.id, 'payment_failed');
        }
      }
    } catch (e) { console.error('stripe webhook error', e); }
    res.json({ received: true });
  });

  app.post('/api/webhooks/plaid', express.raw({ type: '*/*' }), async (req, res) => {
    const raw = req.body.toString('utf8');
    // SEC-3: verify the Plaid-Verification JWT (signature + body hash) before acting.
    if (!(await verifyPlaidWebhook(req.headers['plaid-verification'] as string, raw)))
      return res.status(401).json({ error: 'webhook verification failed' });
    let body;
    try { body = JSON.parse(raw); } catch { return res.status(400).json({ error: 'invalid JSON' }); }
    // INC-4: full dispatch — sync on transaction updates, flag items needing re-login.
    try {
      const item = body.item_id ? await store.itemByPlaidId(body.item_id) : null;
      if (item && body.webhook_type === 'TRANSACTIONS' && body.webhook_code === 'SYNC_UPDATES_AVAILABLE') {
        const n = await runItemSync(store, item.user_id, item.id, decrypt(item.access_token_ciphertext), item.sync_cursor);
        await store.audit(item.user_id, 'webhook_sync', `${n} txns`);
      } else if (item && body.webhook_type === 'ITEM' && (body.webhook_code === 'ERROR' || body.webhook_code === 'ITEM_LOGIN_REQUIRED' || body.error?.error_code === 'ITEM_LOGIN_REQUIRED')) {
        await store.setItemStatus(item.id, 'login_required');
        await store.audit(item.user_id, 'item_login_required', item.institution_name);
      }
    } catch (e) { console.error('plaid webhook error', e); }
    res.json({ received: true });
  });

  /* ================= REGULAR API ================= */
  app.use(express.json({ limit: '12mb' }));
  app.use(express.text({ type: 'text/csv', limit: '12mb' }));

  // ---- auth (S8/S9): dev header mode, or Entra External ID JWT (INFRA-5) ----
  const jwks = cfg.authMode === 'entra' && process.env.ENTRA_JWKS_URL
    ? createRemoteJWKSet(new URL(process.env.ENTRA_JWKS_URL)) : null;
  app.use('/api', async (req, res, next) => {
    if (req.path === '/health' || req.path === '/plans') return next();
    if (cfg.authMode === 'dev') {
      const email = String(req.headers['x-user-email'] || '');
      if (!email) return res.status(401).json({ error: 'missing x-user-email (dev auth)' });
      (req as never as { user: User }).user = await store.getOrCreateUser(email);
      return next();
    }
    // Production: verify the Entra External ID bearer token (signature, expiry, audience).
    if (!jwks) return res.status(503).json({ error: 'auth misconfigured: ENTRA_JWKS_URL not set' });
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'missing bearer token' });
    try {
      const { payload } = await jwtVerify(token, jwks, { audience: process.env.ENTRA_AUDIENCE });
      const sub = String(payload.sub), email = String(payload.email || payload.preferred_username || sub + '@entra.local');
      (req as never as { user: User }).user = await store.getOrCreateUserBySub(sub, email);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid token' });
    }
  });
  const u = (req: express.Request): User => (req as never as { user: User }).user;

  app.get('/api/health', (_q, res) => res.json({ ok: true, mode: { db: !!cfg.databaseUrl, plaid: cfg.plaid.mock ? 'mock' : cfg.plaid.env, stripe: cfg.stripe.mock ? 'mock' : 'live', auth: cfg.authMode } }));
  app.get('/api/plans', (_q, res) => res.json(Object.entries(PLAN_PRICES).map(([id, p]) => ({ id, label: p.label, amountCents: p.amount }))));
  app.get('/api/me', async (req, res) => {
    const items = await store.listItems(u(req).id);
    const sub = await store.getSubscription(u(req).id);
    res.json({ ...u(req), items: items.map(i => ({ id: i.id, institution: i.institution_name, status: i.status })), subscription: sub });
  });
  app.get('/api/me/export', async (req, res) => {
    res.json({ user: u(req), transactions: await store.allTx(u(req).id), accounts: await store.listAccounts(u(req).id), overrides: await store.getOverrides(u(req).id) });
  });
  app.delete('/api/me', async (req, res) => {
    for (const it of await store.listItems(u(req).id)) { try { await Plaid.removeItem(decrypt(it.access_token_ciphertext)); } catch { /* item may be gone */ } }
    await store.deleteUser(u(req).id);
    await store.audit(null, 'account_deleted', u(req).email);
    res.json({ deleted: true });
  });

  // ---- CSV import (F4) ----
  app.post('/api/import/csv', async (req, res) => {
    const text = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (!text) return res.status(400).json({ error: 'send CSV as text/csv body or {csv}' });
    const rows = parseCSV(text);
    if (rows.length < 2) return res.status(422).json({ error: 'no data rows found' });
    const map = autoMap(rows);
    if (map.date < 0 || map.desc < 0 || (map.amt < 0 && map.debit < 0 && map.credit < 0))
      return res.status(422).json({ error: 'could not detect date/description/amount columns', detected: map });
    const overrides = await store.getOverrides(u(req).id);
    const existing = await store.txKeys(u(req).id);
    const out = []; let skipped = 0, dupes = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const date = parseDateStr(r[map.date]);
      let amt: number | null = null;
      if (map.amt >= 0) amt = parseAmtStr(r[map.amt]);
      else {
        const d = map.debit >= 0 ? parseAmtStr(r[map.debit]) : null;
        const c = map.credit >= 0 ? parseAmtStr(r[map.credit]) : null;
        if (d) amt = -Math.abs(d); else if (c) amt = Math.abs(c);
      }
      if (!date || amt === null) { skipped++; continue; }
      const raw = String(r[map.desc] ?? '').trim() || '(no description)';
      const key = `${date}|${amt}|${cleanDesc(raw)}`;
      if (existing.has(key)) { dupes++; continue; }
      existing.add(key);
      const merch = merchant(raw);
      let category = classify(raw, amt);
      if (amt < 0 && overrides[merch]) category = overrides[merch];
      out.push({ user_id: u(req).id, date, name: cleanDesc(raw), merchant: merch, amount: amt, balance: map.bal >= 0 ? parseAmtStr(r[map.bal]) : null, category, source: 'csv', plaid_transaction_id: null });
    }
    const inserted = await store.insertTx(out);
    await store.audit(u(req).id, 'csv_import', `${inserted} rows`);
    res.json({ imported: inserted, skipped, duplicates: dupes });
  });

  // ---- transactions (F9) ----
  app.get('/api/transactions', async (req, res) => {
    const q = req.query;
    const days = +(q.days || 0);
    const all = await store.allTx(u(req).id);
    const latest = all.length ? all[all.length - 1].date : new Date().toISOString().slice(0, 10);
    const from = days ? new Date(Date.parse(latest) - days * 864e5).toISOString().slice(0, 10) : undefined;
    const r = await store.listTx(u(req).id, {
      from, cat: q.cat as string, flow: q.flow as string, search: q.q as string,
      limit: Math.min(200, +(q.limit || 25)), offset: +(q.offset || 0),
      sort: (q.sort as string) || 'date', dir: (q.dir as string) || 'desc'
    });
    res.json(r);
  });
  app.post('/api/transactions/recategorize', async (req, res) => {
    const { merchant: m, category } = req.body || {};
    if (!m || !ALL_CATS.includes(category)) return res.status(400).json({ error: 'merchant + valid category required' });
    await store.setOverride(u(req).id, m, category);
    const n = await store.setCategoryByMerchant(u(req).id, m, category);
    res.json({ updated: n });
  });
  app.get('/api/categories', (_q, res) => res.json(ALL_CATS));

  // ---- summary + advisor (F7/F8/F10) ----
  app.get('/api/summary', async (req, res) => {
    const tx = await store.allTx(u(req).id);
    const latest = tx.length ? tx[tx.length - 1].date : new Date().toISOString().slice(0, 10);
    res.json(summarize(tx, +(req.query.days || 365), latest));
  });
  app.get('/api/advisor', async (req, res) => {
    const tx = await store.allTx(u(req).id);
    const latest = tx.length ? tx[tx.length - 1].date : new Date().toISOString().slice(0, 10);
    res.json(advise(tx, +(req.query.days || 365), latest));
  });

  // ---- accounts (INC-2) ----
  app.get('/api/accounts', async (req, res) => {
    res.json({ items: await store.listItems(u(req).id), accounts: await store.listAccounts(u(req).id) });
  });

  // ---- Plaid (F3, P1-P5) ----
  // SEC-1: tight per-user limit — bank linking is rare, abuse is not.
  const linkLimiter = rateLimit({ windowMs: 60_000, max: 5, keyGenerator: (req) => (req as never as { user?: User }).user?.id || req.ip || 'anon' });
  app.post('/api/plaid/link-token', linkLimiter, async (req, res) => {
    const limit = PLAN_LIMITS[u(req).plan]?.items ?? 0;
    if (await store.countItems(u(req).id) >= limit)
      return res.status(402).json({ error: `plan "${u(req).plan}" allows ${limit} bank connection(s) — upgrade to add more`, upgrade: true });
    res.json(await Plaid.createLinkToken(u(req).id));
  });
  app.post('/api/plaid/exchange', linkLimiter, async (req, res) => {
    const { public_token } = req.body || {};
    if (!public_token) return res.status(400).json({ error: 'public_token required' });
    const limit = PLAN_LIMITS[u(req).plan]?.items ?? 0;
    if (await store.countItems(u(req).id) >= limit)
      return res.status(402).json({ error: 'plan limit reached', upgrade: true });
    const ex = await Plaid.exchangePublicToken(public_token);
    const item = await store.addItem({
      user_id: u(req).id, plaid_item_id: ex.item_id, institution_name: ex.institution,
      access_token_ciphertext: encryptToken(ex.access_token), sync_cursor: null, status: 'healthy'
    });
    const n = await runItemSync(store, u(req).id, item.id, ex.access_token, null);
    await store.audit(u(req).id, 'plaid_link', ex.institution);
    res.json({ item: { id: item.id, institution: ex.institution }, imported: n });
  });
  app.post('/api/plaid/sync', async (req, res) => {
    let total = 0;
    for (const it of await store.listItems(u(req).id))
      total += await runItemSync(store, u(req).id, it.id, decrypt(it.access_token_ciphertext), it.sync_cursor);
    res.json({ imported: total });
  });
  app.delete('/api/plaid/items/:id', async (req, res) => {
    const it = (await store.listItems(u(req).id)).find(i => i.id === req.params.id);
    if (!it) return res.status(404).json({ error: 'not found' });
    try { await Plaid.removeItem(decrypt(it.access_token_ciphertext)); } catch { /* already removed */ }
    await store.removeItem(u(req).id, it.id);
    await store.audit(u(req).id, 'plaid_unlink', it.institution_name);
    res.json({ removed: true });
  });

  // ---- Stripe (F13) ----
  app.post('/api/billing/checkout', async (req, res) => {
    const { plan } = req.body || {};
    if (!PLAN_PRICES[plan]) return res.status(400).json({ error: 'plan must be personal|family|enterprise' });
    const out = await Billing.createCheckout(u(req).id, u(req).email, plan);
    if (out.mock) {
      await store.setPlan(u(req).id, plan, 'cus_mock_' + u(req).id.slice(0, 8));
      await store.upsertSubscription({ user_id: u(req).id, stripe_subscription_id: 'sub_mock', plan, status: 'active', current_period_end: null });
    }
    res.json(out);
  });
  app.post('/api/billing/portal', async (req, res) => {
    if (!u(req).stripe_customer_id) return res.status(400).json({ error: 'no billing on file' });
    res.json(await Billing.createPortal(u(req).stripe_customer_id!));
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()!); // split on / AND \\ (Windows)
if (isMain) {
  // SEC-2: fail fast if production is missing its encryption key (also enforced in crypto.ts).
  if (cfg.authMode !== 'dev' && !cfg.tokenEncKey) {
    console.error('FATAL: TOKEN_ENC_KEY must be set in production'); process.exit(1);
  }
  const store = await makeStore();
  const app = await buildApp(store);
  app.listen(cfg.port, () => console.log(`Osborn Finance API on :${cfg.port} (auth=${cfg.authMode}, plaid=${cfg.plaid.mock ? 'mock' : cfg.plaid.env}, stripe=${cfg.stripe.mock ? 'mock' : 'live'})`));
}

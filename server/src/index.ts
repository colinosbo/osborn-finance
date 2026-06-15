import './loadenv.js'; // load server/.env (skipped under test) before config reads process.env
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { cfg, PLAN_LIMITS, assertSecureConfig } from './config.js';
import { schemas, parse } from './validate.js';
import { makeStore, type Store, type User } from './store.js';
import { classify, merchant, cleanDesc, ALL_CATS } from './classifier.js';
import { parseCSV, autoMap, parseDateStr, parseAmtStr } from './csv.js';
import { summarize } from './analytics.js';
import { buildAdvisor } from './advisor.js';
import { Plaid, runItemSync, encryptToken, verifyPlaidWebhook } from './plaid.js';
import { Billing, PLAN_PRICES, parseStripeEvent, verifyStripeSignature, fetchSubscriptionPlan } from './stripe.js';
import { decrypt } from './crypto.js';
import { buildReport, buildRangeReport, buildMonthReport, CADENCES, type Cadence } from './reports.js';
import { detectRecurring } from './recurring.js';
import { projectGoals } from './goals.js';
import { buildDebtPlan } from './debt.js';

// Resolve a request's time window to [from (exclusive), to (inclusive)]. Accepts an
// explicit calendar month (from/to) or a rolling day-window (days), anchored on today.
function rangeWindow(query: Record<string, unknown>, today: string, defDays: number): { from: string; to: string } {
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const qf = typeof query.from === 'string' && dateRe.test(query.from) ? query.from : '';
  const qt = typeof query.to === 'string' && dateRe.test(query.to) ? query.to : '';
  if (qf) return { from: qf, to: qt || today };
  const days = query.days != null ? Math.max(0, Math.min(100000, Number(query.days) || 0)) : defDays;
  const from = days ? new Date(Date.parse(today) - days * 864e5).toISOString().slice(0, 10) : '';
  return { from, to: today };
}

export async function buildApp(store: Store) {
  const app = express();
  // Behind Front Door / a reverse proxy: trust the first XFF hop so req.ip and
  // rate-limit keys reflect the real client (L3).
  app.set('trust proxy', 1);
  // Dynamic financial responses should never be served as an empty 304; disabling
  // ETags avoids conditional-request empty bodies the client can't parse as JSON.
  app.set('etag', false);
  app.use(helmet());
  app.use(cors({ origin: cfg.appBaseUrl }));
  app.use(rateLimit({ windowMs: 60_000, max: 300 }));

  // L3: salted hash of the client IP for audit correlation. Prefers the leftmost
  // X-Forwarded-For entry (the original client) when behind a proxy.
  const ipHash = (req: express.Request): string => {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = xff || req.ip || 'unknown';
    return createHash('sha256').update(cfg.auditIpSalt + '|' + ip).digest('hex').slice(0, 32);
  };

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
    } catch (e) { console.error('stripe webhook error:', (e as Error).message); } // L1: message only, never raw provider bodies
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
    } catch (e) { console.error('plaid webhook error:', (e as Error).message); } // L1: message only, never raw provider bodies
    res.json({ received: true });
  });

  /* ================= REGULAR API ================= */
  app.use(express.json({ limit: '12mb' }));
  app.use(express.text({ type: 'text/csv', limit: '12mb' }));

  // ---- auth (S8/S9): dev header mode, or Entra External ID JWT (INFRA-5) ----
  const jwks = cfg.authMode === 'entra' && cfg.entra.jwksUrl
    ? createRemoteJWKSet(new URL(cfg.entra.jwksUrl)) : null;
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
      // H2: pin BOTH audience and issuer. Audience alone does not bind the token
      // to our tenant/authority; issuer validation rejects validly-signed tokens
      // minted for our audience by any other tenant on a multi-tenant key set.
      const { payload } = await jwtVerify(token, jwks, { audience: cfg.entra.audience, issuer: cfg.entra.issuer });
      const sub = String(payload.sub), email = String(payload.email || payload.preferred_username || sub + '@entra.local');
      (req as never as { user: User }).user = await store.getOrCreateUserBySub(sub, email);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid token' });
    }
  });
  const u = (req: express.Request): User => (req as never as { user: User }).user;

  // L2: the anonymous probe reveals nothing about configuration.
  app.get('/api/health', (_q, res) => res.json({ ok: true }));
  // Detailed mode is gated behind auth (not in the middleware skip list above).
  app.get('/api/health/details', (_q, res) => res.json({ ok: true, mode: { db: !!cfg.databaseUrl, plaid: cfg.plaid.mock ? 'mock' : cfg.plaid.env, stripe: cfg.stripe.mock ? 'mock' : 'live', auth: cfg.authMode } }));
  app.get('/api/plans', (_q, res) => res.json(Object.entries(PLAN_PRICES).map(([id, p]) => ({ id, label: p.label, amountCents: p.amount }))));
  app.get('/api/me', async (req, res) => {
    const items = await store.listItems(u(req).id);
    const sub = await store.getSubscription(u(req).id);
    res.json({ ...u(req), items: items.map(i => ({ id: i.id, institution: i.institution_name, status: i.status })), subscription: sub });
  });
  app.get('/api/me/export', async (req, res) => {
    res.json({ user: u(req), transactions: await store.allTx(u(req).id), accounts: await store.listAccounts(u(req).id), overrides: await store.getOverrides(u(req).id), goals: await store.listGoals(u(req).id) });
  });
  app.delete('/api/me', async (req, res) => {
    for (const it of await store.listItems(u(req).id)) { try { await Plaid.removeItem(decrypt(it.access_token_ciphertext)); } catch { /* item may be gone */ } }
    await store.deleteUser(u(req).id);
    await store.audit(null, 'account_deleted', u(req).email, ipHash(req));
    res.json({ deleted: true });
  });

  // ---- CSV import (F4) ----
  app.post('/api/import/csv', async (req, res) => {
    const text = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (!text) return res.status(400).json({ error: 'send CSV as text/csv body or {csv}' });
    const rows = parseCSV(text);
    if (rows.length < 2) return res.status(422).json({ error: 'no data rows found' });
    // M6: cap row count to bound per-request memory/CPU and DB load.
    const MAX_CSV_ROWS = 20000;
    if (rows.length - 1 > MAX_CSV_ROWS)
      return res.status(413).json({ error: `too many rows: ${rows.length - 1} (max ${MAX_CSV_ROWS}). Split the file and re-import.` });
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
      out.push({ user_id: u(req).id, date, name: cleanDesc(raw), merchant: merch, amount: amt, balance: map.bal >= 0 ? parseAmtStr(r[map.bal]) : null, category, source: 'csv', plaid_transaction_id: null, item_id: null });
    }
    const inserted = await store.insertTx(out);
    await store.audit(u(req).id, 'csv_import', `${inserted} rows`, ipHash(req));
    res.json({ imported: inserted, skipped, duplicates: dupes });
  });

  // ---- transactions (F9) ----
  app.get('/api/transactions', async (req, res) => {
    const v = parse(schemas.transactionsQuery, req.query); // I3
    if (!v.ok) return res.status(400).json({ error: v.error });
    const q = v.data;
    const today = new Date().toISOString().slice(0, 10);
    // Explicit from/to (a calendar month) wins; otherwise a rolling day-window anchored on today.
    let from: string | undefined, to: string | undefined;
    if (q.from) { from = q.from; to = q.to; }
    else { const days = q.days || 0; from = days ? new Date(Date.parse(today) - days * 864e5).toISOString().slice(0, 10) : undefined; }
    const r = await store.listTx(u(req).id, {
      from, to, cat: q.cat, flow: q.flow, search: q.q,
      limit: q.limit || 25, offset: q.offset || 0,
      sort: q.sort || 'date', dir: q.dir || 'desc'
    });
    res.json(r);
  });
  app.post('/api/transactions/recategorize', async (req, res) => {
    const v = parse(schemas.recategorize, req.body); // I3
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { merchant: m, category } = v.data;
    await store.setOverride(u(req).id, m, category);
    const n = await store.setCategoryByMerchant(u(req).id, m, category);
    res.json({ updated: n });
  });
  // Re-apply the current classifier rules (and saved overrides) to every existing
  // transaction. Useful after the rules improve, so old data picks up the changes.
  app.post('/api/transactions/reclassify', async (req, res) => {
    const userId = u(req).id;
    const txs = await store.allTx(userId);
    const overrides = await store.getOverrides(userId);
    const updates: { id: string; category: string }[] = [];
    for (const t of txs) {
      let cat: string;
      if (t.amount > 0) cat = 'Income & Refunds';
      else { cat = classify(t.name, t.amount); if (overrides[t.merchant]) cat = overrides[t.merchant]; }
      if (cat !== t.category) updates.push({ id: t.id, category: cat });
    }
    const n = await store.setTxCategories(userId, updates);
    await store.audit(userId, 'reclassify', `${n} txns`, ipHash(req));
    res.json({ updated: n, total: txs.length });
  });
  app.get('/api/categories', (_q, res) => res.json(ALL_CATS));
  // Months the user actually has activity in, most recent first, capped to the
  // last 12. A month is only listed if at least one transaction falls inside that
  // month's window using the EXACT same filter the summary route uses (from = last
  // day of prev month, exclusive; to = last day of this month, inclusive). Sharing
  // the predicate guarantees a listed month can never come back empty in summary.
  app.get('/api/tx-months', async (req, res) => {
    const tx = await store.allTx(u(req).id);
    const monthWindow = (ym: string) => {
      const [y, m] = ym.split('-').map(Number);
      return {
        from: new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10),
        to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
      };
    };
    const candidates = new Set<string>();
    for (const t of tx) candidates.add(t.date.slice(0, 7));
    const months = [...candidates]
      .filter(ym => { const { from, to } = monthWindow(ym); return tx.some(t => t.date > from && t.date <= to); })
      .sort().reverse().slice(0, 12);
    res.json({ months });
  });

  // ---- summary + advisor (F7/F8/F10) ----
  app.get('/api/summary', async (req, res) => {
    const tx = await store.allTx(u(req).id);
    const { from, to } = rangeWindow(req.query, new Date().toISOString().slice(0, 10), 365);
    res.json(summarize(tx, from, to));
  });
  app.get('/api/advisor', async (req, res) => {
    const tx = await store.allTx(u(req).id);
    const goals = await store.listGoals(u(req).id);
    const { from, to } = rangeWindow(req.query, new Date().toISOString().slice(0, 10), 365);
    res.json(buildAdvisor(tx, goals, from, to));
  });

  // ---- accounts (INC-2) ----
  app.get('/api/accounts', async (req, res) => {
    res.json({ items: await store.listItems(u(req).id), accounts: await store.listAccounts(u(req).id) });
  });

  // ---- debt payoff planner: profit-driven plan over linked loan/credit accounts ----
  app.get('/api/debt', async (req, res) => {
    const extra = req.query.extra != null ? Math.max(0, Math.min(1e7, +req.query.extra || 0)) : undefined;
    const accts = await store.listAccounts(u(req).id);
    const tx = await store.allTx(u(req).id);
    res.json(buildDebtPlan(accts, tx, extra));
  });

  // ---- subscription tracker: detect recurring charges from transactions ----
  app.get('/api/recurring', async (req, res) => {
    res.json(detectRecurring(await store.allTx(u(req).id)));
  });

  // A linked credit/loan account is a debt to pay DOWN, not money saved.
  const isLiabilityType = (t?: string) => /credit|loan|mortgage|student|line of credit/i.test(t || '');

  // ---- savings & debt-payoff goals: on-pace projection from net cash flow ----
  app.get('/api/goals', async (req, res) => {
    const goals = await store.listGoals(u(req).id);
    const accts = await store.listAccounts(u(req).id);
    const acctById = Object.fromEntries(accts.map(a => [a.id, a]));
    // Linked goals auto-sync from the account's live balance.
    // savings: saved = balance. payoff: saved = how much of the debt is paid down (start - current).
    for (const g of goals) if (g.account_id && acctById[g.account_id]) {
      const bal = Math.max(0, acctById[g.account_id].current_balance || 0);
      g.saved_amount = g.kind === 'payoff' && g.start_balance != null ? Math.max(0, g.start_balance - bal) : bal;
    }
    const out = projectGoals(goals, await store.allTx(u(req).id));
    out.goals = out.goals.map(gv => ({
      ...gv,
      account: gv.account_id && acctById[gv.account_id]
        ? { id: gv.account_id, name: acctById[gv.account_id].name, mask: acctById[gv.account_id].mask }
        : null
    }));
    res.json(out);
  });
  app.post('/api/goals', async (req, res) => {
    const v = parse(schemas.goalCreate, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    // Derive the goal kind from the linked account (server is authoritative).
    let kind: 'savings' | 'payoff' = 'savings';
    let start_balance: number | null = null;
    let target = v.data.target_amount;
    let saved = v.data.saved_amount ?? 0;
    if (v.data.account_id) {
      const acct = (await store.listAccounts(u(req).id)).find(a => a.id === v.data.account_id);
      if (acct && isLiabilityType(acct.type)) {
        kind = 'payoff';
        start_balance = Math.max(0, acct.current_balance || 0);
        target = start_balance; // paying the whole balance off
        saved = 0;              // computed live from the balance
      }
    }
    const g = await store.createGoal({
      user_id: u(req).id, name: v.data.name, target_amount: target,
      saved_amount: saved, target_date: v.data.target_date ?? null,
      color: v.data.color ?? '#7c3aed', account_id: v.data.account_id ?? null,
      kind, start_balance
    });
    await store.audit(u(req).id, 'goal_created', g.name, ipHash(req));
    res.json(g);
  });
  app.patch('/api/goals/:id', async (req, res) => {
    const v = parse(schemas.goalUpdate, req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const g = await store.updateGoal(u(req).id, req.params.id, v.data);
    if (!g) return res.status(404).json({ error: 'goal not found' });
    res.json(g);
  });
  app.delete('/api/goals/:id', async (req, res) => {
    if (!(await store.deleteGoal(u(req).id, req.params.id))) return res.status(404).json({ error: 'goal not found' });
    res.json({ deleted: true });
  });

  // ---- reports: a calendar month (?from=&to=, like the rest of the app), or an
  // arbitrary day range (?days=30) as a fallback, generated on the spot ----
  app.get('/api/reports', async (req, res) => {
    const tx = await store.allTx(u(req).id);
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : '';
    const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : (to ? to.slice(0, 7) : '');
    if (month) return res.json(buildMonthReport(tx, month));
    const v = parse(schemas.reportRange, req.query);
    if (!v.ok) return res.status(400).json({ error: v.error });
    res.json(buildRangeReport(tx, v.data.days || 30, v.data.offset || 0));
  });
  // ---- reports: named cadences (weekly | monthly | six_month | year_in_review) ----
  app.get('/api/reports/:cadence', async (req, res) => {
    const cadence = req.params.cadence as Cadence;
    if (!CADENCES.includes(cadence)) return res.status(400).json({ error: 'unknown cadence' });
    const v = parse(schemas.reportQuery, req.query);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const tx = await store.allTx(u(req).id);
    res.json(buildReport(tx, cadence, v.data.offset || 0));
  });

  // ---- Plaid (F3, P1-P5) ----
  // SEC-1: per-user limit on bank linking (rare action, but abuse is not). Kept
  // generous enough that normal retries during setup don't trip it.
  const linkLimiter = rateLimit({ windowMs: 60_000, max: 20, keyGenerator: (req) => (req as never as { user?: User }).user?.id || req.ip || 'anon' });
  app.post('/api/plaid/link-token', linkLimiter, async (req, res) => {
    const limit = PLAN_LIMITS[u(req).plan]?.items ?? 0;
    if (await store.countItems(u(req).id) >= limit)
      return res.status(402).json({ error: `plan "${u(req).plan}" allows ${limit} bank connection(s), upgrade to add more`, upgrade: true });
    try { res.json(await Plaid.createLinkToken(u(req).id)); }
    catch (e) { console.error('plaid link-token error:', (e as Error).message); res.status(502).json({ error: 'Could not start bank linking: ' + (e as Error).message }); }
  });
  app.post('/api/plaid/exchange', linkLimiter, async (req, res) => {
    const v = parse(schemas.plaidExchange, req.body); // I3
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { public_token } = v.data;
    const limit = PLAN_LIMITS[u(req).plan]?.items ?? 0;
    if (await store.countItems(u(req).id) >= limit)
      return res.status(402).json({ error: 'plan limit reached', upgrade: true });
    let ex;
    try {
      ex = await Plaid.exchangePublicToken(public_token);
    } catch (e) {
      console.error('plaid exchange error:', (e as Error).message);
      return res.status(502).json({ error: 'Bank link failed at token exchange: ' + (e as Error).message });
    }
    const item = await store.addItem({
      user_id: u(req).id, plaid_item_id: ex.item_id, institution_name: ex.institution,
      access_token_ciphertext: encryptToken(ex.access_token), sync_cursor: null, status: 'healthy'
    });
    // The bank is linked once the token is exchanged. An initial-sync hiccup
    // (e.g. PRODUCT_NOT_READY in sandbox) must NOT fail the link; it syncs later.
    let imported = 0, syncWarning: string | undefined;
    try { imported = await runItemSync(store, u(req).id, item.id, ex.access_token, null); }
    catch (e) { syncWarning = (e as Error).message; console.error('initial sync deferred:', syncWarning); }
    await store.audit(u(req).id, 'plaid_link', ex.institution, ipHash(req));
    res.json({ item: { id: item.id, institution: ex.institution }, imported, syncWarning });
  });
  app.post('/api/plaid/sync', async (req, res) => {
    try {
      let total = 0;
      for (const it of await store.listItems(u(req).id))
        total += await runItemSync(store, u(req).id, it.id, decrypt(it.access_token_ciphertext), it.sync_cursor);
      res.json({ imported: total });
    } catch (e) { console.error('plaid sync error:', (e as Error).message); res.status(502).json({ error: 'Sync failed: ' + (e as Error).message }); }
  });
  app.delete('/api/plaid/items/:id', async (req, res) => {
    const it = (await store.listItems(u(req).id)).find(i => i.id === req.params.id);
    if (!it) return res.status(404).json({ error: 'not found' });
    try { await Plaid.removeItem(decrypt(it.access_token_ciphertext)); } catch { /* already removed */ }
    await store.removeItem(u(req).id, it.id);
    await store.audit(u(req).id, 'plaid_unlink', it.institution_name, ipHash(req));
    res.json({ removed: true });
  });

  // ---- Stripe (F13) ----
  app.post('/api/billing/checkout', async (req, res) => {
    const v = parse(schemas.checkout, req.body); // I3
    if (!v.ok) return res.status(400).json({ error: v.error });
    const { plan } = v.data;
    try {
      const out = await Billing.createCheckout(u(req).id, u(req).email, plan);
      if (out.mock) {
        await store.setPlan(u(req).id, plan, 'cus_mock_' + u(req).id.slice(0, 8));
        await store.upsertSubscription({ user_id: u(req).id, stripe_subscription_id: 'sub_mock', plan, status: 'active', current_period_end: null });
      }
      res.json(out);
    } catch (e) { console.error('checkout error:', (e as Error).message); res.status(502).json({ error: 'Could not start checkout, please try again.' }); }
  });
  app.post('/api/billing/portal', async (req, res) => {
    if (!u(req).stripe_customer_id) return res.status(400).json({ error: 'no billing on file' });
    try { res.json(await Billing.createPortal(u(req).stripe_customer_id!)); }
    catch (e) { console.error('portal error:', (e as Error).message); res.status(502).json({ error: 'Could not open the billing portal, please try again.' }); }
  });

  // Unmatched API routes return JSON (not an HTML 404 the client can't parse).
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }));
  // Final safety net: any thrown/forwarded error becomes a JSON 500 instead of an
  // empty or HTML body (which the client saw as "Unexpected end of JSON input").
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('route error:', err?.message);
    if (res.headersSent) return;
    res.status(500).json({ error: err?.message || 'server error' });
  });

  return app;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop()!); // split on / AND \\ (Windows)
if (isMain) {
  // H1/H2/SEC-2: refuse to boot on any fatal auth/crypto misconfiguration.
  const problems = assertSecureConfig();
  if (problems.length) {
    for (const p of problems) console.error('FATAL config:', p);
    process.exit(1);
  }
  // Keep the server alive: a single failed request (e.g. a Plaid/Stripe call that
  // throws) must never crash the whole process. Node terminates on unhandled
  // rejections by default; log and continue instead.
  process.on('unhandledRejection', (reason) => console.error('unhandledRejection:', reason instanceof Error ? reason.message : reason));
  process.on('uncaughtException', (err) => console.error('uncaughtException:', err?.message || err));

  const store = await makeStore();
  const app = await buildApp(store);
  app.listen(cfg.port, () => console.log(`Osborn Finance API on :${cfg.port} (auth=${cfg.authMode}, plaid=${cfg.plaid.mock ? 'mock' : cfg.plaid.env}, stripe=${cfg.stripe.mock ? 'mock' : 'live'})`));
}

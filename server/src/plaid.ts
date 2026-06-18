// Plaid client: real sandbox/production when keys set, deterministic mock otherwise.
import { cfg } from './config.js';
import { classify, classifyFromPlaid, merchant, cleanDesc } from './classifier.js';
import type { Store } from './store.js';
import { captureSnapshots, seedMockHistory } from './snapshots.js';
import { encrypt } from './crypto.js';
import { createHash } from 'crypto';
import { jwtVerify, importJWK, decodeProtectedHeader, type JWK } from 'jose';

interface PlaidTxn { transaction_id: string; date: string; name: string; amount: number; pending: boolean; account_id?: string; merchant_name?: string | null; personal_finance_category?: { primary?: string; detailed?: string } | null; }

async function plaidPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://${cfg.plaid.env}.plaid.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.plaid.clientId, secret: cfg.plaid.secret, ...body })
  });
  // L1: do NOT fold the raw provider body into the error, it can echo request
  // data / identifiers that then land in logs. Surface status + a Plaid error code only.
  if (!res.ok) {
    let code = '';
    try { code = ((await res.json()) as { error_code?: string }).error_code || ''; } catch { /* non-JSON body */ }
    throw new Error(`plaid ${path} failed: ${res.status}${code ? ` (${code})` : ''}`);
  }
  return res.json();
}

export const Plaid = {
  async createLinkToken(userId: string) {
    if (cfg.plaid.mock) return { link_token: 'link-mock-' + userId.slice(0, 8), mock: true };
    const j = await plaidPost('/link/token/create', {
      user: { client_user_id: userId },
      client_name: 'Covisor',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
      webhook: process.env.PLAID_WEBHOOK_URL || undefined
    });
    return { link_token: j.link_token, mock: false };
  },
  async exchangePublicToken(publicToken: string) {
    if (cfg.plaid.mock) return { access_token: 'access-mock-' + publicToken, item_id: 'item-mock-' + Math.random().toString(36).slice(2, 10), institution: 'Mock Community Bank' };
    const j = await plaidPost('/item/public_token/exchange', { public_token: publicToken });
    // Resolve the real institution name (Chase, Fidelity, ...) by looking up the
    // item's institution_id. Wrapped so a lookup failure never blocks linking.
    let institution = 'Connected Bank';
    try {
      const it = await plaidPost('/item/get', { access_token: j.access_token });
      const instId = it.item?.institution_id;
      if (instId) {
        const inst = await plaidPost('/institutions/get_by_id', { institution_id: instId, country_codes: ['US'] });
        institution = inst.institution?.name || institution;
      }
    } catch (e) { console.error('institution lookup failed:', (e as Error).message); }
    return { access_token: j.access_token, item_id: j.item_id, institution };
  },
  async syncTransactions(accessToken: string, cursor: string | null): Promise<{ added: PlaidTxn[]; next_cursor: string }> {
    if (cfg.plaid.mock) {
      if (cursor === 'done') return { added: [], next_cursor: 'done' };
      const today = new Date();
      const added: PlaidTxn[] = [];
      const names: [string, string | null][] = [['STARBUCKS STORE 0882', 'Starbucks'], ['WAL-MART SUPERCENTER', 'Walmart'], ['SHELL OIL 5744', 'Shell'], ['TARGET 00078', 'Target'], ['CHIPOTLE 1187', 'Chipotle'], ['ACME LOGISTICS INC PAYROLL DIRECT DEP', null]];
      for (let i = 0; i < 30; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i * 3);
        const [name, merchant_name] = names[i % names.length];
        // Plaid convention: positive = outflow; we negate on import
        added.push({ transaction_id: 'mock-' + accessToken.slice(-6) + '-' + i, date: d.toISOString().slice(0, 10), name, merchant_name, amount: name.includes('PAYROLL') ? -1420 : +(5 + (i * 7.13) % 80).toFixed(2), pending: false });
      }
      // Clean monthly subscriptions (~30-day cadence, steady amount) so the
      // recurring detector and the report's subscriptions section are demoable.
      for (const [name, mname, amt] of [['NETFLIX.COM', 'Netflix', 15.49], ['SPOTIFY USA', 'Spotify', 11.99], ['HULU 877-824-4858', 'Hulu', 17.99]] as [string, string, number][]) {
        for (let k = 0; k < 4; k++) {
          const d = new Date(today); d.setDate(d.getDate() - k * 30);
          added.push({ transaction_id: `mock-sub-${name.slice(0, 4)}-${k}`, date: d.toISOString().slice(0, 10), name, merchant_name: mname, amount: amt, pending: false });
        }
      }
      return { added, next_cursor: 'done' };
    }
    try {
      const j = await plaidPost('/transactions/sync', { access_token: accessToken, cursor: cursor || undefined, count: 500 });
      return { added: j.added || [], next_cursor: j.next_cursor }; // production: also handle j.modified / j.removed
    } catch (e) {
      // Right after linking, sandbox/production often need a moment before
      // transactions exist. Treat "not ready" as zero new txns, not a failure.
      if ((e as Error).message.includes('PRODUCT_NOT_READY')) return { added: [], next_cursor: cursor || '' };
      throw e;
    }
  },
  async removeItem(accessToken: string) {
    if (cfg.plaid.mock) return;
    await plaidPost('/item/remove', { access_token: accessToken });
  },
  // INC-2: pull account names + live balances alongside transactions.
  async getAccounts(accessToken: string): Promise<Array<{ account_id: string; name: string; mask: string; type: string; balance: number }>> {
    if (cfg.plaid.mock) {
      // Mix of asset and liability accounts so net worth + the debt planner are demonstrable.
      return [
        { account_id: 'acc-mock-chk-' + accessToken.slice(-6), name: 'Everyday Checking', mask: '3131', type: 'checking', balance: 2483.12 },
        { account_id: 'acc-mock-sav-' + accessToken.slice(-6), name: 'Kasasa Saver', mask: '4318', type: 'savings', balance: 5120.55 },
        { account_id: 'acc-mock-cc-' + accessToken.slice(-6), name: 'Rewards Credit Card', mask: '7782', type: 'credit', balance: 3450.18 },
        { account_id: 'acc-mock-loan-' + accessToken.slice(-6), name: 'Auto Loan', mask: '2210', type: 'loan', balance: 14200.00 },
        { account_id: 'acc-mock-inv-' + accessToken.slice(-6), name: 'Brokerage', mask: '9021', type: 'brokerage', balance: 18540.32 },
        { account_id: 'acc-mock-ira-' + accessToken.slice(-6), name: 'Roth IRA', mask: '5567', type: 'ira', balance: 22310.00 }
      ];
    }
    const j = await plaidPost('/accounts/balance/get', { access_token: accessToken });
    return (j.accounts || []).map((a: { account_id: string; name: string; mask: string; subtype: string; balances: { current: number } }) =>
      ({ account_id: a.account_id, name: a.name, mask: a.mask, type: a.subtype, balance: a.balances?.current ?? 0 }));
  }
};

// SEC-3: verify the Plaid-Verification JWT (ES256) on every webhook.
// Plaid signs webhooks with a rotating key fetched from /webhook_verification_key/get.
const plaidKeyCache = new Map<string, { jwk: JWK; at: number }>();
export async function verifyPlaidWebhook(verificationJwt: string | undefined, rawBody: string): Promise<boolean> {
  if (cfg.plaid.mock) return true; // mock mode: webhooks only reachable in local dev
  if (!verificationJwt) return false;
  try {
    const header = decodeProtectedHeader(verificationJwt);
    if (header.alg !== 'ES256' || !header.kid) return false;
    let cached = plaidKeyCache.get(header.kid);
    if (!cached || Date.now() - cached.at > 5 * 60_000) {
      const j = await plaidPost('/webhook_verification_key/get', { key_id: header.kid });
      cached = { jwk: j.key, at: Date.now() };
      plaidKeyCache.set(header.kid, cached);
    }
    const key = await importJWK(cached.jwk, 'ES256');
    const { payload } = await jwtVerify(verificationJwt, key, { maxTokenAge: '5 min' });
    const bodyHash = createHash('sha256').update(rawBody, 'utf8').digest('hex');
    return payload['request_body_sha256'] === bodyHash;
  } catch {
    return false;
  }
}

export async function runItemSync(store: Store, userId: string, itemDbId: string, accessToken: string, cursor: string | null) {
  // Accounts + balances FIRST so they appear immediately, even if transactions
  // aren't ready yet right after linking. (Previously transactions ran first and
  // a not-ready error there meant accounts never synced.)
  const accts = await Plaid.getAccounts(accessToken);
  await store.upsertAccounts(accts.map(a => ({
    item_id: itemDbId, user_id: userId, plaid_account_id: a.account_id,
    name: a.name, mask: a.mask, type: a.type, current_balance: a.balance
  })));
  // Opportunistic balance snapshot on every sync (free, idempotent per day). This
  // feeds the Investments change-in-value calc. seedMockHistory is mock-only.
  const myAccts = (await store.listAccounts(userId)).filter(a => a.item_id === itemDbId);
  await seedMockHistory(store, userId, myAccts);
  await captureSnapshots(store, userId, myAccts);
  // Transactions next (may legitimately be empty for a freshly linked item).
  const overrides = await store.getOverrides(userId);
  const { added, next_cursor } = await Plaid.syncTransactions(accessToken, cursor);
  // Map each Plaid account id to its name so transactions carry which account they
  // belong to — required for netting transfers between the user's own accounts.
  const acctName = new Map(accts.map(a => [a.account_id, a.name]));
  const rows = added.filter(t => !t.pending).map(t => {
    const amount = -t.amount; // Plaid: positive = money out
    // Prefer Plaid's cleaned merchant_name (e.g. "Amazon") over our descriptor cleaner:
    // it's more accurate and lets refund netting match a card refund to its purchase by
    // vendor (Pass 1) before resorting to amount-only matching.
    const merch = (t.merchant_name && t.merchant_name.trim()) || merchant(t.name);
    let category: string;
    if (amount > 0) {
      // Inflow: classify() splits real income from refunds (return/reversal/credit) by
      // descriptor, so a refunded purchase that posts as a credit isn't counted as income.
      category = classify(t.name, amount);
      if (overrides[merch]) category = overrides[merch];
    } else {
      // Prefer Plaid's own categorization; fall back to keyword rules (e.g. CSV-like names).
      const fromPlaid = classifyFromPlaid(t.personal_finance_category);
      category = fromPlaid && fromPlaid !== 'Income' ? fromPlaid : classify(t.name, amount);
      if (overrides[merch]) category = overrides[merch];
    }
    return { user_id: userId, date: t.date, name: cleanDesc(t.name), merchant: merch, amount, balance: null, category, source: 'plaid', plaid_transaction_id: t.transaction_id, item_id: itemDbId, account: t.account_id ? (acctName.get(t.account_id) || null) : null };
  });
  await store.insertTx(rows);
  if (next_cursor) await store.setCursor(itemDbId, next_cursor);
  return rows.length;
}

export function encryptToken(token: string) { return encrypt(token); }

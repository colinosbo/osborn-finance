// Plaid client — real sandbox/production when keys set, deterministic mock otherwise.
import { cfg } from './config.js';
import { classify, merchant, cleanDesc } from './classifier.js';
import type { Store } from './store.js';
import { encrypt } from './crypto.js';
import { createHash } from 'crypto';
import { jwtVerify, importJWK, decodeProtectedHeader, type JWK } from 'jose';

interface PlaidTxn { transaction_id: string; date: string; name: string; amount: number; pending: boolean; }

async function plaidPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://${cfg.plaid.env}.plaid.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.plaid.clientId, secret: cfg.plaid.secret, ...body })
  });
  // L1: do NOT fold the raw provider body into the error — it can echo request
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
      client_name: 'Osborn Finance',
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
    return { access_token: j.access_token, item_id: j.item_id, institution: 'Connected Bank' };
  },
  async syncTransactions(accessToken: string, cursor: string | null): Promise<{ added: PlaidTxn[]; next_cursor: string }> {
    if (cfg.plaid.mock) {
      if (cursor === 'done') return { added: [], next_cursor: 'done' };
      const today = new Date();
      const added: PlaidTxn[] = [];
      const names = ['STARBUCKS STORE 0882', 'WAL-MART SUPERCENTER', 'SHELL OIL 5744', 'NETFLIX.COM', 'CHIPOTLE 1187', 'ACME LOGISTICS INC PAYROLL DIRECT DEP'];
      for (let i = 0; i < 30; i++) {
        const d = new Date(today); d.setDate(d.getDate() - i * 3);
        const name = names[i % names.length];
        // Plaid convention: positive = outflow; we negate on import
        added.push({ transaction_id: 'mock-' + accessToken.slice(-6) + '-' + i, date: d.toISOString().slice(0, 10), name, amount: name.includes('PAYROLL') ? -1420 : +(5 + (i * 7.13) % 80).toFixed(2), pending: false });
      }
      return { added, next_cursor: 'done' };
    }
    const j = await plaidPost('/transactions/sync', { access_token: accessToken, cursor: cursor || undefined, count: 500 });
    return { added: j.added, next_cursor: j.next_cursor }; // production: also handle j.modified / j.removed
  },
  async removeItem(accessToken: string) {
    if (cfg.plaid.mock) return;
    await plaidPost('/item/remove', { access_token: accessToken });
  },
  // INC-2: pull account names + live balances alongside transactions.
  async getAccounts(accessToken: string): Promise<Array<{ account_id: string; name: string; mask: string; type: string; balance: number }>> {
    if (cfg.plaid.mock) {
      return [
        { account_id: 'acc-mock-chk-' + accessToken.slice(-6), name: 'Everyday Checking', mask: '3131', type: 'checking', balance: 2483.12 },
        { account_id: 'acc-mock-sav-' + accessToken.slice(-6), name: 'Kasasa Saver', mask: '4318', type: 'savings', balance: 5120.55 }
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
  const overrides = await store.getOverrides(userId);
  const { added, next_cursor } = await Plaid.syncTransactions(accessToken, cursor);
  const rows = added.filter(t => !t.pending).map(t => {
    const amount = -t.amount; // Plaid: positive = money out
    const merch = merchant(t.name);
    let category = classify(t.name, amount);
    if (amount < 0 && overrides[merch]) category = overrides[merch];
    return { user_id: userId, date: t.date, name: cleanDesc(t.name), merchant: merch, amount, balance: null, category, source: 'plaid', plaid_transaction_id: t.transaction_id };
  });
  await store.insertTx(rows);
  await store.setCursor(itemDbId, next_cursor);
  // INC-2: refresh account list + balances on every sync.
  const accts = await Plaid.getAccounts(accessToken);
  await store.upsertAccounts(accts.map(a => ({
    item_id: itemDbId, user_id: userId, plaid_account_id: a.account_id,
    name: a.name, mask: a.mask, type: a.type, current_balance: a.balance
  })));
  return rows.length;
}

export function encryptToken(token: string) { return encrypt(token); }

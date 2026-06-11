// Plaid client — real sandbox/production when keys set, deterministic mock otherwise.
import { cfg } from './config.js';
import { classify, merchant, cleanDesc } from './classifier.js';
import type { Store } from './store.js';
import { encrypt } from './crypto.js';

interface PlaidTxn { transaction_id: string; date: string; name: string; amount: number; pending: boolean; }

async function plaidPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`https://${cfg.plaid.env}.plaid.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.plaid.clientId, secret: cfg.plaid.secret, ...body })
  });
  if (!res.ok) throw new Error(`plaid ${path} ${res.status}: ${await res.text()}`);
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
  }
};

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
  return rows.length;
}

export function encryptToken(token: string) { return encrypt(token); }

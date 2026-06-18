import { describe, it, expect } from 'vitest';
import { detectRecurring } from '../src/recurring.js';
import type { Tx } from '../src/store.js';

let seq = 0;
const tx = (o: Partial<Tx>): Tx => ({
  id: 't' + (seq++), user_id: 'u', date: '2026-06-01', name: '', merchant: '',
  amount: 0, balance: null, category: 'Subscriptions & Digital', source: 'csv', account: null, ...o,
});

// Build N monthly charges for a vendor.
const monthly = (merchant: string, name: string, amount: number) =>
  ['2026-04-01', '2026-05-01', '2026-06-01'].map(d => tx({ date: d, merchant, name, amount }));

describe('subscription labels match the ledger merchant', () => {
  it('labels an Apple subscription "Apple", not the descriptor city "Cupertino"', () => {
    const rows = monthly('Apple', 'APPLE.COM BILL 866-712-7753 CUPERTINO CA', -10.99);
    const { subscriptions } = detectRecurring(rows, '2026-06-16');
    const labels = subscriptions.map(s => s.merchant);
    expect(labels).toContain('Apple');
    expect(labels).not.toContain('Cupertino');
  });

  it('uses the dominant cleaned merchant across mixed descriptors', () => {
    const rows = monthly('Claude', 'ANTHROPIC CLAUDE.AI SUBSCRIPTION', -20.00);
    const { subscriptions } = detectRecurring(rows, '2026-06-16');
    expect(subscriptions.map(s => s.merchant)).toContain('Claude');
  });
});

describe('consumption categories are never subscriptions', () => {
  it('does not treat repeat smoke-shop visits (Vape & Tobacco) as a subscription', () => {
    const rows: Tx[] = [
      tx({ date: '2025-09-13', merchant: 'Smokers Den', name: 'SMOKERS DEN PLAINFIELD IL', amount: -11.20, category: 'Vape & Tobacco' }),
      tx({ date: '2025-12-14', merchant: 'Smokers Den', name: 'SMOKERS DEN PLAINFIELD IL', amount: -11.50, category: 'Vape & Tobacco' }),
      tx({ date: '2026-03-14', merchant: 'Smokers Den', name: 'SMOKERS DEN PLAINFIELD IL', amount: -11.40, category: 'Vape & Tobacco' }),
      tx({ date: '2026-06-14', merchant: 'Smokers Den', name: 'SMOKERS DEN PLAINFIELD IL', amount: -11.40, category: 'Vape & Tobacco' }),
      tx({ date: '2026-06-15', merchant: 'Smokers Den', name: 'SMOKERS DEN PLAINFIELD IL', amount: -35.00, category: 'Vape & Tobacco' }),
    ];
    const { subscriptions } = detectRecurring(rows, '2026-06-16');
    expect(subscriptions.map(s => s.merchant)).not.toContain('Smokers Den');
  });
});

describe('price-change date consistency', () => {
  it('counts the new-price charge as the most recent: "since" is never after "last charged"', () => {
    const rows: Tx[] = [
      tx({ date: '2026-04-01', merchant: 'Claude', name: 'ANTHROPIC CLAUDE', amount: -20.00 }),
      tx({ date: '2026-05-01', merchant: 'Claude', name: 'ANTHROPIC CLAUDE', amount: -20.00 }),
      tx({ date: '2026-06-01', merchant: 'Claude', name: 'ANTHROPIC CLAUDE', amount: -20.00 }),
      tx({ date: '2026-06-11', merchant: 'Claude', name: 'ANTHROPIC CLAUDE', amount: -5.00 }),
    ];
    const { subscriptions } = detectRecurring(rows, '2026-06-16');
    const claude = subscriptions.find(s => s.merchant === 'Claude')!;
    expect(claude.priceChange).toBeTruthy();
    expect(claude.lastCharged).toBe('2026-06-11');
    expect(claude.priceChange!.since <= claude.lastCharged).toBe(true);
    expect(claude.count).toBe(4);
    expect(claude.nextCharge > claude.lastCharged).toBe(true);
  });
});

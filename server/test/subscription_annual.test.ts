import { describe, it, expect } from 'vitest';
import { detectRecurring } from '../src/recurring.js';
import type { Tx } from '../src/store.js';

describe('Subscription annual cost equals monthly x 12', () => {
  let n = 0;
  const mk = (date: string, amount: number): Tx => ({
    id: `t${n++}`, user_id: 'u', date, name: 'NETFLIX.COM', merchant: 'Netflix',
    amount, balance: null, category: 'Subscriptions & Digital', source: 'csv'
  });
  it('reports a $500/mo charge as $6,000/yr (not $5,995)', () => {
    const tx = ['2026-02-15', '2026-03-15', '2026-04-15', '2026-05-15', '2026-06-15'].map(d => mk(d, -500));
    const s = detectRecurring(tx, '2026-06-17').subscriptions[0];
    expect(s.monthlyCost).toBe(500);
    expect(s.annualCost).toBe(6000);
  });
});

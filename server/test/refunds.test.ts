import { describe, it, expect } from 'vitest';
import { detectRefunds, withoutRefunds } from '../src/refunds.js';
import type { Tx } from '../src/store.js';

// Minimal Tx factory — detectRefunds only reads id, amount, merchant, name, date.
let n = 0;
const tx = (p: Partial<Tx> & { amount: number; date: string }): Tx => ({
  id: p.id ?? `t${++n}`,
  user_id: 'u1',
  date: p.date,
  name: p.name ?? p.merchant ?? 'X',
  merchant: p.merchant ?? '',
  amount: p.amount,
  balance: null,
  category: p.category ?? (p.amount > 0 ? 'Income & Refunds' : 'Shopping'),
  source: 'csv'
});

describe('refund netting (detectRefunds)', () => {
  it('nets an exact charge + later refund at the same merchant', () => {
    const rows = [
      tx({ id: 'c', merchant: 'Walmart', amount: -50, date: '2026-01-10' }),
      tx({ id: 'r', merchant: 'Walmart', amount: 50, date: '2026-01-20' })
    ];
    const { nettedIds, roleById } = detectRefunds(rows);
    expect([...nettedIds].sort()).toEqual(['c', 'r']);
    expect(roleById.get('c')).toBe('charge');
    expect(roleById.get('r')).toBe('refund');
  });

  it('ignores partial refunds (full refunds only)', () => {
    const rows = [
      tx({ merchant: 'Walmart', amount: -50, date: '2026-01-10' }),
      tx({ merchant: 'Walmart', amount: 20, date: '2026-01-20' })
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });

  it('ignores refunds beyond the 60-day window', () => {
    const rows = [
      tx({ merchant: 'Walmart', amount: -50, date: '2026-01-10' }),
      tx({ merchant: 'Walmart', amount: 50, date: '2026-04-01' }) // ~81 days later
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });

  it('does not match a refund that predates the charge', () => {
    const rows = [
      tx({ merchant: 'Walmart', amount: 50, date: '2026-01-10' }),
      tx({ merchant: 'Walmart', amount: -50, date: '2026-01-20' })
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });

  it('requires the same merchant', () => {
    const rows = [
      tx({ merchant: 'Walmart', amount: -50, date: '2026-01-10' }),
      tx({ merchant: 'Target', amount: 50, date: '2026-01-20' })
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });

  it('pairs one refund to a single charge, picking the most recent prior one', () => {
    const rows = [
      tx({ id: 'old', merchant: 'Walmart', amount: -50, date: '2026-01-01' }),
      tx({ id: 'new', merchant: 'Walmart', amount: -50, date: '2026-01-15' }),
      tx({ id: 'r', merchant: 'Walmart', amount: 50, date: '2026-01-20' })
    ];
    const { nettedIds, roleById } = detectRefunds(rows);
    expect([...nettedIds].sort()).toEqual(['new', 'r']);
    expect(roleById.get('new')).toBe('charge');
    expect(nettedIds.has('old')).toBe(false);
  });

  it('withoutRefunds drops exactly the matched pair and keeps everything else', () => {
    const rows = [
      tx({ id: 'c', merchant: 'Walmart', amount: -50, date: '2026-01-10' }),
      tx({ id: 'r', merchant: 'Walmart', amount: 50, date: '2026-01-20' }),
      tx({ id: 'keep1', merchant: 'Rent Co', amount: -1200, date: '2026-01-01' }),
      tx({ id: 'keep2', name: 'Payroll', amount: 3000, date: '2026-01-15' })
    ];
    const kept = withoutRefunds(rows).map(t => t.id).sort();
    expect(kept).toEqual(['keep1', 'keep2']);
  });
});

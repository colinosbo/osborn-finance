import { describe, it, expect } from 'vitest';
import { detectRefunds, withoutRefunds } from '../src/refunds.js';
import type { Tx } from '../src/store.js';

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
      tx({ merchant: 'Walmart', amount: 50, date: '2026-04-01' })
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

  it('nets an unlisted vendor whose charge/refund descriptors differ by direction + RETURN', () => {
    const rows = [
      tx({ id: 'c', merchant: 'Withdrawal Debit Card', name: 'Withdrawal DEBIT CARD THE ITEM SHOP CHICAGO IL', amount: -89.99, date: '2026-05-03' }),
      tx({ id: 'r', merchant: 'Deposit Debit Card', name: 'Deposit DEBIT CARD THE ITEM SHOP CHICAGO IL RETURN', amount: 89.99, date: '2026-05-13' })
    ];
    expect([...detectRefunds(rows).nettedIds].sort()).toEqual(['c', 'r']);
  });

  it('nets the same chain across two different store locations', () => {
    const rows = [
      tx({ id: 'c', merchant: 'Walmart', name: 'POS WM SUPERCENTER #1256 JOLIET IL', amount: -50, date: '2026-05-01' }),
      tx({ id: 'r', merchant: 'Walmart', name: 'DEBIT CARD WAL-MART #4529 NEW LENOX IL', amount: 50, date: '2026-05-09' })
    ];
    expect([...detectRefunds(rows).nettedIds].sort()).toEqual(['c', 'r']);
  });

  it('still does not net two genuinely different vendors at the same amount', () => {
    const rows = [
      tx({ id: 'c', merchant: '', name: 'Withdrawal DEBIT CARD JOLIET CAFE JOLIET IL', amount: -25, date: '2026-05-01' }),
      tx({ id: 'r', merchant: '', name: 'Deposit DEBIT CARD CREST HILL DINER CREST HILL IL', amount: 25, date: '2026-05-05' })
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });
});

describe('refund netting — amount-only fallback for anonymous deposits', () => {
  // The reported case: a $1077 check payment to a vendor, refunded a month later as a
  // generic "MOBILE DEPOSIT" (a redeposited check) with NO merchant identity. No shared
  // vendor and no refund keyword — only the exact amount + time order link them.
  it('nets a charge against a later same-amount generic deposit (no shared vendor)', () => {
    const rows = [
      tx({ id: 'c', name: 'LINCOLN LAND COM LINCOLN LA', amount: -1077, date: '2026-05-13', category: 'Education' }),
      tx({ id: 'r', name: 'MOBILE DEPOSIT', amount: 1077, date: '2026-06-16' }),
    ];
    expect([...detectRefunds(rows).nettedIds].sort()).toEqual(['c', 'r']);
  });

  it('does NOT amount-match a deposit that NAMES a different merchant', () => {
    // A credit that identifies a store ("Target") must only match that store, never a
    // same-amount charge elsewhere — otherwise unrelated activity cancels out.
    const rows = [
      tx({ id: 'c', merchant: 'Walmart', name: 'WALMART', amount: -60, date: '2026-05-01' }),
      tx({ id: 'r', merchant: 'Target', name: 'TARGET REFUND', amount: 60, date: '2026-05-10' }),
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });

  it('does NOT amount-match a generic deposit with no matching prior expense', () => {
    const rows = [
      tx({ id: 'c', name: 'LINCOLN LAND COM LINCOLN LA', amount: -1077, date: '2026-05-13', category: 'Education' }),
      tx({ id: 'r', name: 'MOBILE DEPOSIT', amount: 500, date: '2026-06-16' }), // different amount
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });

  it('does NOT cancel real income (payroll) even via a deposit of a matching amount', () => {
    const rows = [
      tx({ id: 'c', name: 'SOME STORE', amount: -2000, date: '2026-05-01', category: 'Shopping' }),
      tx({ id: 'r', name: 'DIRECT DEP PAYROLL ACME', amount: 2000, date: '2026-05-15' }),
    ];
    expect(detectRefunds(rows).nettedIds.size).toBe(0);
  });
});

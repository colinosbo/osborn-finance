import { describe, it, expect } from 'vitest';
import { detectTransfers, withoutTransfers, isInternalTransfer } from '../src/transfers.js';
import type { Tx } from '../src/store.js';

let seq = 0;
const tx = (o: Partial<Tx>): Tx => ({
  id: 'tx' + (seq++), user_id: 'u', date: '2026-05-03', name: '', merchant: '',
  amount: 0, balance: null, category: 'Other', source: 'csv', account: null, ...o,
});

describe('internal-transfer netting (between two known accounts)', () => {
  const mkPair = (acctOut: string | null, acctIn: string | null) => ([
    tx({ name: 'Withdrawal Home Banking Transfer To Savings 0001', amount: -200, account: acctOut }),
    tx({ name: 'Deposit Home Banking Transfer From Checking 0114', amount: 200, account: acctIn }),
  ]);

  it('nets a transfer pair across two DIFFERENT known accounts', () => {
    const rows = mkPair('Checking (0114)', 'Savings (0001)');
    const { nettedIds, roleById } = detectTransfers(rows);
    expect(nettedIds.size).toBe(2);
    expect(new Set(roleById.values())).toEqual(new Set(['transfer_out', 'transfer_in']));
    expect(withoutTransfers(rows).length).toBe(0);
  });

  it('does NOT net when both legs are the SAME account', () => {
    expect(detectTransfers(mkPair('Checking (0114)', 'Checking (0114)')).nettedIds.size).toBe(0);
  });

  it('does NOT net when an account is unknown (null/blank)', () => {
    expect(detectTransfers(mkPair(null, 'Savings (0001)')).nettedIds.size).toBe(0);
    expect(detectTransfers(mkPair('Checking (0114)', '   ')).nettedIds.size).toBe(0);
  });

  it('works for Plaid-sourced rows the same way (account = linked account name)', () => {
    const rows = [
      tx({ source: 'plaid', name: 'ONLINE TRANSFER TO SAVINGS', amount: -200, account: 'Everyday Checking' }),
      tx({ source: 'plaid', name: 'ONLINE TRANSFER FROM CHECKING', amount: 200, account: 'Kasasa Saver' }),
    ];
    expect(detectTransfers(rows).nettedIds.size).toBe(2);
  });

  it('does NOT net coincidental equal-and-opposite non-transfers', () => {
    const rows = [
      tx({ name: 'WAL-MART SUPERCENTER', amount: -200, account: 'Checking (0114)' }),
      tx({ name: 'ACME PAYROLL DIRECT DEP', amount: 200, account: 'Savings (0001)' }),
    ];
    expect(detectTransfers(rows).nettedIds.size).toBe(0);
  });

  it('does NOT net external P2P (Venmo/Zelle) — not an internal transfer', () => {
    const rows = [
      tx({ name: 'Zelle payment to Carlos', amount: -200, account: 'Checking (0114)' }),
      tx({ name: 'Venmo cashout', amount: 200, account: 'Savings (0001)' }),
    ];
    expect(rows.some(isInternalTransfer)).toBe(false);
    expect(detectTransfers(rows).nettedIds.size).toBe(0);
  });

  it('does NOT net when amounts differ', () => {
    const rows = mkPair('Checking (0114)', 'Savings (0001)');
    rows[1].amount = 199.99;
    expect(detectTransfers(rows).nettedIds.size).toBe(0);
  });
});

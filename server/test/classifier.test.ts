import { describe, it, expect } from 'vitest';
import { classify, looksLikeIncome } from '../src/classifier.js';

describe('Income classification: payroll processors & deposits', () => {
  it('recognizes payroll-processor credits as income', () => {
    expect(classify('ACH Electronic CreditGUSTO PAY 123456', 5850)).toBe('Income');
    expect(looksLikeIncome('ACH Electronic CreditGUSTO PAY 123456')).toBe(true);
    expect(looksLikeIncome('DIRECT DEPOSIT ADP PAYROLL')).toBe(true);
    expect(looksLikeIncome('PAYCHEX EIB INVOICE')).toBe(true);
    expect(looksLikeIncome('RIPPLING PAYROLL')).toBe(true);
  });
  it('still treats a merchant refund as a refund, not income', () => {
    expect(classify('DEBIT CARD ACME OUTDOORS REFUND', 200)).toBe('Refunds');
  });
  it('does not call an ordinary purchase income', () => {
    expect(looksLikeIncome('SPARKFUN ELECTRONICS')).toBe(false);
  });
});

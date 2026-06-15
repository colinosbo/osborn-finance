// Debt payoff planner. Pulls liability accounts (credit cards, loans), estimates
// an APR and minimum payment for each by type, looks at the user's monthly profit
// (net cash flow), and simulates a payoff plan: avalanche (highest APR first) vs
// snowball (smallest balance first), plus a minimums-only baseline for comparison.
import type { Tx, Account } from './store.js';
import { monthlyNetCashFlow } from './goals.js';

const r2 = (n: number) => Math.round(n * 100) / 100;
const isLiability = (t?: string) => /credit|loan|mortgage|student|line of credit/i.test(t || '');

// Estimated APR by account type (clearly an estimate, shown to the user).
function estApr(type: string): number {
  const t = (type || '').toLowerCase();
  if (/line of credit/.test(t)) return 0.13;
  if (/credit|paypal/.test(t)) return 0.225;
  if (/student/.test(t)) return 0.055;
  if (/mortgage/.test(t)) return 0.066;
  if (/auto/.test(t)) return 0.075;
  if (/loan/.test(t)) return 0.09;
  return 0.15;
}
// Estimated minimum monthly payment (~2% of balance, with a small floor).
function estMin(balance: number, type: string): number {
  const t = (type || '').toLowerCase();
  const floor = /credit|paypal|line of credit/.test(t) ? 25 : 50;
  return Math.max(floor, r2(balance * 0.02));
}

export interface DebtItem { account_id: string; name: string; mask: string; type: string; balance: number; apr: number; minPayment: number }
export interface PlanStep { account_id: string; name: string; payoffMonth: number; payoffDate: string; interestPaid: number; order: number }
export interface Plan { months: number; totalInterest: number; debtFreeDate: string; steps: PlanStep[]; feasible: boolean }

const MAX_MONTHS = 600;

function simulate(items: DebtItem[], extra: number, strategy: 'avalanche' | 'snowball', anchorISO: string): Plan {
  const bs = items.map(d => ({ ...d, bal: d.balance, interest: 0, payoffMonth: 0 }));
  const order = [...bs].sort(strategy === 'avalanche' ? (a, b) => b.apr - a.apr : (a, b) => a.bal - b.bal);
  let month = 0, totalInterest = 0;
  while (bs.some(d => d.bal > 0.005) && month < MAX_MONTHS) {
    month++;
    for (const d of bs) if (d.bal > 0) { const i = d.bal * (d.apr / 12); d.bal += i; d.interest += i; totalInterest += i; }
    let pool = extra + bs.filter(d => d.bal > 0).reduce((s, d) => s + d.minPayment, 0);
    for (const d of bs) if (d.bal > 0) { const pay = Math.min(d.minPayment, d.bal); d.bal -= pay; pool -= pay; }
    for (const d of order) { if (pool <= 0) break; if (d.bal > 0) { const pay = Math.min(pool, d.bal); d.bal -= pay; pool -= pay; } }
    for (const d of bs) if (d.bal <= 0.005 && d.payoffMonth === 0) d.payoffMonth = month;
  }
  const feasible = !bs.some(d => d.bal > 0.005);
  const steps: PlanStep[] = order.map((d, idx) => {
    const dt = new Date(anchorISO + 'T00:00:00Z'); dt.setUTCMonth(dt.getUTCMonth() + (d.payoffMonth || month));
    return { account_id: d.account_id, name: d.name, order: idx + 1, payoffMonth: d.payoffMonth || month, payoffDate: dt.toISOString().slice(0, 10), interestPaid: r2(d.interest) };
  });
  const free = new Date(anchorISO + 'T00:00:00Z'); free.setUTCMonth(free.getUTCMonth() + month);
  return { months: month, totalInterest: r2(totalInterest), debtFreeDate: free.toISOString().slice(0, 10), steps, feasible };
}

export function buildDebtPlan(accounts: Account[], tx: Tx[], extraOverride?: number) {
  const debts: DebtItem[] = accounts
    .filter(a => isLiability(a.type) && (a.current_balance || 0) > 0)
    .map(a => ({ account_id: a.id, name: a.name, mask: a.mask, type: a.type, balance: r2(a.current_balance || 0), apr: estApr(a.type), minPayment: estMin(a.current_balance || 0, a.type) }))
    .sort((a, b) => b.balance - a.balance);

  const totalDebt = r2(debts.reduce((s, d) => s + d.balance, 0));
  const totalMin = r2(debts.reduce((s, d) => s + d.minPayment, 0));
  const monthlyProfit = r2(monthlyNetCashFlow(tx));
  const suggestedExtra = Math.max(0, monthlyProfit);
  const extra = extraOverride != null ? Math.max(0, r2(extraOverride)) : suggestedExtra;
  const anchorISO = tx.length ? tx[tx.length - 1].date : new Date().toISOString().slice(0, 10);
  const avgApr = totalDebt > 0 ? r2(debts.reduce((s, d) => s + d.apr * d.balance, 0) / totalDebt * 100) : 0;

  if (!debts.length) {
    return { debts: [], totalDebt: 0, totalMin: 0, avgApr: 0, monthlyProfit, suggestedExtra, extra, avalanche: null, snowball: null, minimumsOnly: null, recommended: 'avalanche', interestSavedVsMinimum: 0 };
  }

  const avalanche = simulate(debts, extra, 'avalanche', anchorISO);
  const snowball = simulate(debts, extra, 'snowball', anchorISO);
  const minimumsOnly = simulate(debts, 0, 'avalanche', anchorISO);
  const interestSaved = avalanche.feasible && minimumsOnly.feasible ? r2(minimumsOnly.totalInterest - avalanche.totalInterest) : 0;

  return { debts, totalDebt, totalMin, avgApr, monthlyProfit, suggestedExtra, extra, avalanche, snowball, minimumsOnly, recommended: 'avalanche', interestSavedVsMinimum: Math.max(0, interestSaved) };
}

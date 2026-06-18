// Summary + Advisor engines (server-side ports of the app logic).
import type { Tx } from './store.js';
import { isMovement, isIncome } from './classifier.js';

// Window is [from (exclusive), to (inclusive)]. Empty `from` = no lower bound (all
// time); empty `to` = up to the latest data. The route computes from/to for both a
// rolling day-window and an explicit calendar month.
export function summarize(tx: Tx[], from: string, to: string) {
  const anchor = to || (tx.length ? tx[tx.length - 1].date : new Date().toISOString().slice(0, 10));
  const cur = tx.filter(t => (!from || t.date > from) && (!to || t.date <= to));
  const income = cur.filter(isIncome).reduce((s, t) => s + t.amount, 0);
  // Spending = consumption only. Money movement (debt payoff, transfers, saving) is
  // not spending, so it's excluded from the totals, the donut, and top merchants.
  const isSpend = (t: Tx) => t.amount < 0 && !isMovement(t.category);
  const spend = Math.abs(cur.filter(isSpend).reduce((s, t) => s + t.amount, 0));
  const cats: Record<string, { total: number; count: number }> = {};
  for (const t of cur) if (isSpend(t)) {
    cats[t.category] = cats[t.category] || { total: 0, count: 0 };
    cats[t.category].total += Math.abs(t.amount); cats[t.category].count++;
  }
  const merch: Record<string, { total: number; count: number }> = {};
  for (const t of cur) if (isSpend(t)) {
    merch[t.merchant] = merch[t.merchant] || { total: 0, count: 0 };
    merch[t.merchant].total += Math.abs(t.amount); merch[t.merchant].count++;
  }
  const months: Record<string, { in: number; out: number }> = {};
  for (const t of cur) {
    const k = t.date.slice(0, 7);
    months[k] = months[k] || { in: 0, out: 0 };
    if (isIncome(t)) months[k].in += t.amount; else if (isSpend(t)) months[k].out += Math.abs(t.amount);
  }
  return {
    hasAny: tx.length > 0,
    range: { from: cur[0]?.date || null, to: cur[cur.length - 1]?.date || null, count: cur.length },
    income: r2(income), spend: r2(spend), net: r2(income - spend),
    avgMonthly: avgMonthly(tx, anchor),
    categories: Object.entries(cats).map(([name, v]) => ({ name, total: r2(v.total), count: v.count })).sort((a, b) => b.total - a.total),
    merchants: Object.entries(merch).map(([name, v]) => ({ name, total: r2(v.total), count: v.count })).sort((a, b) => b.total - a.total).slice(0, 12),
    monthly: Object.entries(months).sort().map(([month, v]) => ({ month, in: r2(v.in), out: r2(v.out) }))
  };
}

/**
 * LOG-1 (intentional design): Avg Monthly Spend is a STABLE BASELINE computed over
 * up to the trailing 365 days of the user's full history — deliberately independent
 * of the summary range the user has selected. A 30-day view showing a 30-day
 * "average month" would just echo that month; the product intent (set in the
 * client app and carried here) is "what does a normal month cost me", with
 * single-transaction outliers above max(1.5 × median month, $2,000) excluded.
 */
export function avgMonthly(tx: Tx[], latest: string) {
  const spanD = tx.length ? (Date.parse(tx[tx.length - 1].date) - Date.parse(tx[0].date)) / 864e5 : 0;
  const windowDays = Math.min(365, Math.max(28, Math.ceil(spanD)));
  const cutoff = shift(latest, -windowDays);
  // Consumption only: a "normal month of spending" excludes money movement (debt
  // payoff, transfers, saving), consistent with the Spending KPI it sits beside.
  const win = tx.filter(t => t.date > cutoff && t.amount < 0 && !isMovement(t.category));
  if (!win.length) return { value: 0, excluded: 0, excludedSum: 0, months: 0 };
  const byMonth: Record<string, number> = {};
  for (const t of win) byMonth[t.date.slice(0, 7)] = (byMonth[t.date.slice(0, 7)] || 0) + Math.abs(t.amount);
  const totals = Object.values(byMonth).sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)] || 0;
  const threshold = Math.max(median * 1.5, 2000);
  let excluded = 0, exSum = 0, total = 0;
  for (const t of win) {
    const a = Math.abs(t.amount);
    if (a > threshold) { excluded++; exSum += a; } else total += a;
  }
  const months = Math.max(1, Math.round(windowDays / 30.44));
  return { value: r2(total / months), excluded, excludedSum: r2(exSum), months };
}

export function advise(tx: Tx[], days: number, latest: string) {
  const cutoff = days ? shift(latest, -days) : '';
  const cur = cutoff ? tx.filter(t => t.date > cutoff) : tx;
  const income = cur.filter(isIncome).reduce((s, t) => s + t.amount, 0);
  // Spending = consumption only (exclude debt payoff / transfers / saving).
  const spend = Math.abs(cur.filter(t => t.amount < 0 && !isMovement(t.category)).reduce((s, t) => s + t.amount, 0));
  const dates = cur.map(t => t.date).sort();
  const dayCount = dates.length ? Math.max(1, (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 864e5 + 1) : 1;
  const mo = Math.max(1, dayCount / 30.44);
  const cats: Record<string, { total: number; count: number }> = {};
  for (const t of cur) if (t.amount < 0) {
    cats[t.category] = cats[t.category] || { total: 0, count: 0 };
    cats[t.category].total += Math.abs(t.amount); cats[t.category].count++;
  }
  const get = (c: string) => cats[c]?.total || 0;
  const cnt = (c: string) => cats[c]?.count || 0;
  const per = (c: string) => get(c) / mo;
  const net = income - spend, rate = income > 0 ? net / income * 100 : 0;
  type Tip = { icon: string; title: string; text: string; savePerMonth: number; pinned?: boolean };
  const tips: Tip[] = [];
  if (income <= 0 && spend > 0) tips.push({ icon: '!', title: 'No income detected in this period', savePerMonth: 0, pinned: true, text: `This range only shows spending ($${spend.toFixed(2)}).` });
  else if (net < 0) tips.push({ icon: '!', title: 'You spent more than you earned', savePerMonth: 0, pinned: true, text: `Outflow exceeded income by $${(-net).toFixed(2)} in this period. A common guideline is keeping spending at or below 80% of income.` });
  else if (rate < 10) tips.push({ icon: '%', title: `Thin savings margin (${rate.toFixed(1)}%)`, savePerMonth: 0, pinned: true, text: `You kept $${net.toFixed(2)} of $${income.toFixed(2)} earned. A 20% savings rate means about $${(income * .2 / mo).toFixed(0)}/mo.` });
  else tips.push({ icon: '✓', title: `Solid savings rate (${rate.toFixed(1)}%)`, savePerMonth: 0, pinned: true, text: `You kept $${net.toFixed(2)} of your income. Auto-transfer the surplus on payday so it compounds.` });
  if (get('Dining & Fast Food') > 0 && cnt('Dining & Fast Food') >= 5)
    tips.push({ icon: '🍔', title: `Dining out ${Math.max(1, cnt('Dining & Fast Food') / mo).toFixed(0)}× a month`, savePerMonth: get('Dining & Fast Food') * .33 / mo, text: `${cnt('Dining & Fast Food')} restaurant purchases totaling $${get('Dining & Fast Food').toFixed(0)}. Skipping one of three trips trims a third of the cost.` });
  const subs = cur.filter(t => t.amount < 0 && t.category === 'Subscriptions & Digital');
  const subNames = [...new Set(subs.map(t => t.merchant))];
  if (subNames.length >= 2) tips.push({ icon: '↻', title: `${subNames.length} active subscriptions`, savePerMonth: get('Subscriptions & Digital') * .4 / mo, text: `$${per('Subscriptions & Digital').toFixed(0)}/mo across ${subNames.slice(0, 6).join(', ')}. Audit for overlap.` });
  if (get('Vape & Tobacco') > 0) tips.push({ icon: '⚠', title: 'Vape & tobacco adds up', savePerMonth: per('Vape & Tobacco'), text: `$${get('Vape & Tobacco').toFixed(0)} this period (≈ $${(per('Vape & Tobacco') * 12).toFixed(0)}/yr).` });
  const micro = cur.filter(t => t.amount < 0 && t.amount > -15 && ['Gas & Convenience', 'Groceries & Household', 'Dining & Fast Food'].includes(t.category));
  if (micro.length >= 10) {
    const mt = Math.abs(micro.reduce((s, t) => s + t.amount, 0));
    tips.push({ icon: '¢', title: `${micro.length} purchases under $15`, savePerMonth: mt * .3 / mo, text: `Small convenience buys totaled $${mt.toFixed(0)} ($${(mt / mo).toFixed(0)}/mo).` });
  }
  if (get('Fees') > 0) tips.push({ icon: '$', title: 'Avoidable fees', savePerMonth: per('Fees'), text: `$${get('Fees').toFixed(2)} in ATM/transfer fees. In-network ATMs make this $0.` });
  if (get('Cash Withdrawals') > 0) tips.push({ icon: '?', title: 'Untracked cash', savePerMonth: 0, text: `$${get('Cash Withdrawals').toFixed(0)} withdrawn as cash — invisible to the dashboard.` });
  // Only count recurring-style debt service, not a one-time lump-sum payoff (a charge
  // bigger than the period's income is funded from savings, not monthly cash flow).
  const regularDebt = income > 0 ? Math.abs(cur.filter(t => t.amount < 0 && (t.category === 'Loan Payments' || t.category === 'Credit Card Payments') && Math.abs(t.amount) <= income).reduce((s, t) => s + t.amount, 0)) : 0;
  if (regularDebt > 0 && income > 0 && regularDebt / income > .25) tips.push({ icon: '↓', title: `Debt service is ${(regularDebt / income * 100).toFixed(0)}% of income`, savePerMonth: 0, text: `$${regularDebt.toFixed(0)} went to loans and cards. Prioritize the highest-rate balance.` });
  if (income > 0 && get('Savings & Investments') < income * .05) tips.push({ icon: '↑', title: 'Investing is light', savePerMonth: 0, text: `Only $${per('Savings & Investments').toFixed(0)}/mo to savings/investments. Even 5% of income automated builds momentum.` });
  if (get('P2P & Transfers') > income * .08 && get('P2P & Transfers') > 200) tips.push({ icon: '⇄', title: 'Large P2P outflow', savePerMonth: 0, text: `$${get('P2P & Transfers').toFixed(0)} via P2P apps — easiest spending to lose track of.` });
  const pinned = tips.filter(t => t.pinned);
  const rest = tips.filter(t => !t.pinned).sort((a, b) => b.savePerMonth - a.savePerMonth).slice(0, 6);
  const totalSave = rest.reduce((s, t) => s + t.savePerMonth, 0);
  return { tips: [...pinned, ...rest].map(t => ({ ...t, savePerMonth: r2(t.savePerMonth) })), totalSavePerMonth: r2(totalSave), savingsRate: r2(rate) };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
function shift(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

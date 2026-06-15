// AI Advisor engine: a far richer, still fully-offline analysis over the user's
// transactions + goals. Produces: a financial-health score with factor breakdown,
// a 50/30/20 needs/wants/savings split, period-over-period trends, spending
// anomalies, "wins", and a goal-aware, prioritized action plan.
//
// Backwards-compatible: still exposes `tips`, `totalSavePerMonth`, `savingsRate`
// (the original advise() shape) so existing callers/tests keep working.
import type { Tx, Goal } from './store.js';
import { detectRecurring } from './recurring.js';
import { projectGoals } from './goals.js';

const DAY = 864e5;
const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function shift(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---- needs / wants / savings classification (50-30-20) ----
const NEEDS = new Set(['Rent & Housing', 'Groceries & Household', 'Utilities & Bills', 'Insurance', 'Health & Pharmacy', 'Gas & Convenience', 'Auto', 'Loan Payments', 'Credit Card Payments', 'Taxes', 'Education', 'Legal & Court']);
const SAVINGS = new Set(['Savings & Investments']);
const bucketOf = (cat: string): 'needs' | 'wants' | 'savings' => NEEDS.has(cat) ? 'needs' : SAVINGS.has(cat) ? 'savings' : 'wants';
// "Big by nature": large single charges here are normal, not anomalies.
const BIG_OK = new Set(['Rent & Housing', 'Loan Payments', 'Credit Card Payments', 'Taxes', 'Savings & Investments', 'P2P & Transfers']);

interface CatAgg { total: number; count: number }
function byCat(rows: Tx[]): Record<string, CatAgg> {
  const m: Record<string, CatAgg> = {};
  for (const t of rows) if (t.amount < 0) { (m[t.category] ||= { total: 0, count: 0 }); m[t.category].total += Math.abs(t.amount); m[t.category].count++; }
  return m;
}

export interface AdvisorTip { icon: string; title: string; text: string; savePerMonth: number; savePerYear?: number; pinned?: boolean; goalImpact?: string }
export interface ScoreFactor { label: string; status: 'good' | 'ok' | 'warn'; points: number; max: number; detail: string }

// Window is [from (exclusive), to (inclusive)]; the previous window is the same
// length immediately before it (e.g. last month vs the month before) for trends.
export function buildAdvisor(tx: Tx[], goals: Goal[], from: string, to: string) {
  const cur = tx.filter(t => (!from || t.date > from) && (!to || t.date <= to));
  const windowDays = from && to ? Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / DAY)) : 0;
  const prevFrom = windowDays ? shift(from, -windowDays) : '';
  const prev = windowDays ? tx.filter(t => t.date > prevFrom && t.date <= from) : [];

  const dates = cur.map(t => t.date).sort();
  const dayCount = dates.length ? Math.max(1, (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / DAY + 1) : 1;
  const mo = Math.max(1, dayCount / 30.44);

  const income = cur.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const spend = Math.abs(cur.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const net = income - spend;
  const rate = income > 0 ? net / income * 100 : 0;

  const catCur = byCat(cur);
  const catPrev = byCat(prev);
  const get = (c: string) => catCur[c]?.total || 0;
  const cnt = (c: string) => catCur[c]?.count || 0;
  const per = (c: string) => get(c) / mo;

  const recurring = detectRecurring(cur);
  const goalView = projectGoals(goals, tx);

  // ===================== 50/30/20 BUDGET =====================
  let needs = 0, wants = 0, savingsSpent = 0;
  for (const [c, v] of Object.entries(catCur)) {
    const b = bucketOf(c);
    if (b === 'needs') needs += v.total; else if (b === 'savings') savingsSpent += v.total; else wants += v.total;
  }
  // "savings" = money not consumed (kept surplus + explicit investing); avoids double counting.
  const savings = income > 0 ? Math.max(0, income - needs - wants) : savingsSpent;
  const pctOf = (n: number) => income > 0 ? r2(n / income * 100) : 0;
  const budget = {
    income: r2(income),
    needs: { amount: r2(needs), pct: pctOf(needs), guide: 50 },
    wants: { amount: r2(wants), pct: pctOf(wants), guide: 30 },
    savings: { amount: r2(savings), pct: pctOf(savings), guide: 20 },
    verdict: income <= 0 ? 'Not enough income in this range to map a 50/30/20 budget.'
      : pctOf(savings) >= 20 && pctOf(needs) <= 55 ? "You're tracking close to the 50/30/20 guideline, with essentials in check and a healthy savings slice."
      : pctOf(needs) > 60 ? `Essentials eat ${pctOf(needs)}% of income (guideline ~50%). Housing, utilities and debt are the heavy hitters here.`
      : pctOf(savings) < 10 ? `Only ${pctOf(savings)}% is left after spending (guideline ~20%). Trimming "wants" is the fastest lever.`
      : `Wants are ${pctOf(wants)}% of income (guideline ~30%). A small trim there lifts your savings rate quickly.`
  };

  // ===================== HEALTH SCORE =====================
  const factors: ScoreFactor[] = [];
  // 1) savings rate (0..30)
  const fSave = clamp(rate >= 20 ? 30 : rate <= 0 ? 0 : (rate / 20) * 30, 0, 30);
  factors.push({ label: 'Savings rate', max: 30, points: r2(fSave),
    status: fSave >= 21 ? 'good' : fSave >= 12 ? 'ok' : 'warn',
    detail: income > 0 ? `Keeping ${r2(rate)}% of income. Aim for 20%+.` : 'No income detected to measure against.' });
  // 2) essentials ratio (0..20)
  const needsPct = income > 0 ? needs / income * 100 : 100;
  const fNeeds = clamp(needsPct <= 50 ? 20 : needsPct >= 70 ? 0 : (1 - (needsPct - 50) / 20) * 20, 0, 20);
  factors.push({ label: 'Essentials load', max: 20, points: r2(fNeeds),
    status: fNeeds >= 14 ? 'good' : fNeeds >= 8 ? 'ok' : 'warn',
    detail: `Needs are ${r2(needsPct)}% of income (target ≤ 50%).` });
  // 3) debt service (0..20)
  const debt = get('Loan Payments') + get('Credit Card Payments');
  const debtPct = income > 0 ? debt / income * 100 : 0;
  const fDebt = clamp(debtPct <= 10 ? 20 : debtPct >= 40 ? 0 : (1 - (debtPct - 10) / 30) * 20, 0, 20);
  factors.push({ label: 'Debt service', max: 20, points: r2(fDebt),
    status: fDebt >= 14 ? 'good' : fDebt >= 8 ? 'ok' : 'warn',
    detail: debt > 0 ? `${r2(debtPct)}% of income to loans & cards (target ≤ 10%).` : 'No loan or card payments this period.' });
  // 4) subscription load (0..15)
  const subMonthly = recurring.totals.monthlyTotal;
  const subPct = income > 0 ? subMonthly / (income / mo) * 100 : 0;
  const fSubs = clamp(subPct <= 4 ? 15 : subPct >= 14 ? 0 : (1 - (subPct - 4) / 10) * 15, 0, 15);
  factors.push({ label: 'Subscription weight', max: 15, points: r2(fSubs),
    status: fSubs >= 11 ? 'good' : fSubs >= 6 ? 'ok' : 'warn',
    detail: `${recurring.totals.activeCount} active subscriptions ≈ ${r2(subPct)}% of income.` });
  // 5) spending stability (0..15): coefficient of variation of monthly spend (full history)
  const byMonth: Record<string, number> = {};
  for (const t of tx) if (t.amount < 0) byMonth[t.date.slice(0, 7)] = (byMonth[t.date.slice(0, 7)] || 0) + Math.abs(t.amount);
  const months = Object.values(byMonth);
  let cov = 0;
  if (months.length >= 3) { const mean = months.reduce((s, x) => s + x, 0) / months.length; const sd = Math.sqrt(months.reduce((s, x) => s + (x - mean) ** 2, 0) / months.length); cov = mean ? sd / mean : 0; }
  const fStab = months.length < 3 ? 9 : clamp(cov <= 0.15 ? 15 : cov >= 0.5 ? 3 : (1 - (cov - 0.15) / 0.35) * 12 + 3, 0, 15);
  factors.push({ label: 'Spending stability', max: 15, points: r2(fStab),
    status: fStab >= 11 ? 'good' : fStab >= 7 ? 'ok' : 'warn',
    detail: months.length < 3 ? 'Not enough history yet to gauge month-to-month swings.' : `Month-to-month spending varies about ${Math.round(cov * 100)}%.` });

  const scoreVal = Math.round(factors.reduce((s, f) => s + f.points, 0));
  const grade = scoreVal >= 85 ? 'A' : scoreVal >= 70 ? 'B' : scoreVal >= 55 ? 'C' : scoreVal >= 40 ? 'D' : 'F';
  const scoreLabel = scoreVal >= 85 ? 'Excellent. Your money is working hard.'
    : scoreVal >= 70 ? 'Healthy. A few tweaks would push you higher.'
    : scoreVal >= 55 ? 'Fair, with some clear, fixable pressure points.'
    : scoreVal >= 40 ? 'Strained. Worth tackling the red factors below.'
    : 'At risk. Spending is outpacing a sustainable plan.';
  const score = { value: scoreVal, grade, label: scoreLabel, factors };

  // ===================== TRENDS (vs previous period) =====================
  const trends: { category: string; now: number; prev: number; deltaPct: number; deltaAbs: number; direction: 'up' | 'down' | 'new' }[] = [];
  if (prev.length) {
    for (const [c, v] of Object.entries(catCur)) {
      const p = catPrev[c]?.total || 0;
      const deltaAbs = v.total - p;
      if (Math.abs(deltaAbs) < 40) continue;
      if (p === 0 && v.total >= 60) { trends.push({ category: c, now: r2(v.total), prev: 0, deltaPct: 100, deltaAbs: r2(deltaAbs), direction: 'new' }); continue; }
      if (p === 0) continue;
      const deltaPct = deltaAbs / p * 100;
      if (Math.abs(deltaPct) < 20) continue;
      trends.push({ category: c, now: r2(v.total), prev: r2(p), deltaPct: Math.round(deltaPct), deltaAbs: r2(deltaAbs), direction: deltaAbs > 0 ? 'up' : 'down' });
    }
    trends.sort((a, b) => Math.abs(b.deltaAbs) - Math.abs(a.deltaAbs));
  }

  // ===================== ANOMALIES (unusual large charges) =====================
  // Median absolute charge per category over ALL history → flag period charges far above it.
  const catAmounts: Record<string, number[]> = {};
  for (const t of tx) if (t.amount < 0) (catAmounts[t.category] ||= []).push(Math.abs(t.amount));
  const catMed: Record<string, number> = {};
  for (const [c, a] of Object.entries(catAmounts)) catMed[c] = median(a);
  const anomalies = cur.filter(t => t.amount < 0 && !BIG_OK.has(t.category))
    .map(t => ({ t, abs: Math.abs(t.amount), med: catMed[t.category] || 0 }))
    .filter(x => x.med > 0 && x.abs >= Math.max(x.med * 3, 120))
    .sort((a, b) => b.abs - a.abs)
    .slice(0, 5)
    .map(x => ({ date: x.t.date, name: x.t.name, merchant: x.t.merchant, amount: r2(x.t.amount), category: x.t.category, reason: `${(x.abs / x.med).toFixed(1)}× your typical ${x.t.category} charge` }));

  // ===================== WINS (positive reinforcement) =====================
  const wins: { title: string; text: string }[] = [];
  if (rate >= 20) wins.push({ title: `Strong ${r2(rate)}% savings rate`, text: 'You kept a fifth or more of what you earned this period. Keep that surplus automated.' });
  for (const tr of trends.filter(t => t.direction === 'down' && bucketOf(t.category) === 'wants').slice(0, 2))
    wins.push({ title: `${tr.category} down ${Math.abs(tr.deltaPct)}%`, text: `You spent ${'$' + Math.abs(tr.deltaAbs).toFixed(0)} less than last period. Nice restraint.` });
  if (recurring.alerts.increaseCount === 0 && recurring.totals.activeCount > 0) wins.push({ title: 'No subscription price hikes', text: 'None of your recurring charges crept up this period.' });

  // ===================== ACTION PLAN (prioritized, goal-aware) =====================
  const plan: AdvisorTip[] = [];
  const push = (icon: string, title: string, text: string, savePerMonth: number) => plan.push({ icon, title, text, savePerMonth });
  if (get('Dining & Fast Food') > 0 && cnt('Dining & Fast Food') >= 5)
    push('🍔', `Dining out ${Math.max(1, Math.round(cnt('Dining & Fast Food') / mo))}× a month`, `${cnt('Dining & Fast Food')} restaurant purchases totaling $${get('Dining & Fast Food').toFixed(0)}. Skipping one trip in three trims about a third.`, get('Dining & Fast Food') * .33 / mo);
  if (recurring.totals.activeCount >= 2)
    push('↻', `${recurring.totals.activeCount} active subscriptions`, `About $${recurring.totals.monthlyTotal.toFixed(0)}/mo recurring. Cancelling the least-used two typically reclaims ~40%.`, recurring.totals.monthlyTotal * .4);
  if (recurring.alerts.increaseCount > 0)
    push('↑', `${recurring.alerts.increaseCount} subscription price increase${recurring.alerts.increaseCount > 1 ? 's' : ''}`, `Recent hikes add about $${recurring.alerts.monthlyImpact.toFixed(0)}/mo. Review them on the Subscriptions page.`, recurring.alerts.monthlyImpact);
  if (get('Fees') > 0) push('$', 'Avoidable fees', `$${get('Fees').toFixed(2)} in ATM/overdraft/transfer fees. In-network ATMs and balance alerts make most of this $0.`, per('Fees'));
  const micro = cur.filter(t => t.amount < 0 && t.amount > -15 && ['Gas & Convenience', 'Groceries & Household', 'Dining & Fast Food'].includes(t.category));
  if (micro.length >= 10) { const mt = Math.abs(micro.reduce((s, t) => s + t.amount, 0)); push('¢', `${micro.length} small "convenience" buys`, `Under-$15 purchases totaled $${mt.toFixed(0)} ($${(mt / mo).toFixed(0)}/mo). Batching errands cuts the impulse adds.`, mt * .3 / mo); }
  if (get('Bars & Nightlife') > 0 && get('Bars & Nightlife') > income * 0.04) push('🍸', 'Nightlife is a notable slice', `$${get('Bars & Nightlife').toFixed(0)} on bars & nightlife. Setting a weekly cap keeps it fun without the regret.`, per('Bars & Nightlife') * .4);
  if (get('Vape & Tobacco') > 0) push('⚠', 'Vape & tobacco adds up', `$${get('Vape & Tobacco').toFixed(0)} this period (≈ $${(per('Vape & Tobacco') * 12).toFixed(0)}/yr).`, per('Vape & Tobacco'));
  if (income > 0 && get('Savings & Investments') < income * .05) push('↑', 'Investing is light', `Only $${per('Savings & Investments').toFixed(0)}/mo is going to savings/investments. Even 5% of income automated compounds fast.`, 0);

  // goal-aware: redirecting the biggest saving accelerates the soonest active goal
  const activeGoal = goalView.goals.find(g => g.status === 'on_track' || g.status === 'behind' || g.status === 'no_target');
  const topSaver = [...plan].sort((a, b) => b.savePerMonth - a.savePerMonth)[0];
  if (activeGoal && topSaver && topSaver.savePerMonth > 1 && activeGoal.remaining > 0) {
    const baseMonths = activeGoal.monthsToGoal ?? (goalView.totals.monthlyNet > 0 ? activeGoal.remaining / goalView.totals.monthlyNet : null);
    if (baseMonths && goalView.totals.monthlyNet > 0) {
      const fasterMonths = activeGoal.remaining / (goalView.totals.monthlyNet + topSaver.savePerMonth);
      const saved = Math.round(baseMonths - fasterMonths);
      if (saved >= 1) topSaver.goalImpact = `Redirecting this ~$${topSaver.savePerMonth.toFixed(0)}/mo to “${activeGoal.name}” would reach it about ${saved} month${saved > 1 ? 's' : ''} sooner.`;
    }
  }

  // pinned headline (kept first; satisfies the "savings/margin/spent more" contract)
  const headline: AdvisorTip = income <= 0 && spend > 0
    ? { icon: '!', pinned: true, savePerMonth: 0, title: 'No income detected in this period', text: `This range only shows spending ($${spend.toFixed(2)}). Widen the range or import income to get a full picture.` }
    : net < 0
    ? { icon: '!', pinned: true, savePerMonth: 0, title: 'You spent more than you earned', text: `Outflow exceeded income by $${(-net).toFixed(2)}. The action plan below targets the biggest, most painless cuts first.` }
    : rate < 10
    ? { icon: '%', pinned: true, savePerMonth: 0, title: `Thin savings margin (${r2(rate)}%)`, text: `You kept $${net.toFixed(0)} of $${income.toFixed(0)} earned. A 20% rate would be about $${(income * .2 / mo).toFixed(0)}/mo.` }
    : { icon: '✓', pinned: true, savePerMonth: 0, title: `Solid savings rate (${r2(rate)}%)`, text: `You kept $${net.toFixed(0)} of your income. Automate the surplus on payday so it compounds.` };

  const ranked = plan.map(t => ({ ...t, savePerMonth: r2(t.savePerMonth), savePerYear: r2(t.savePerMonth * 12) }))
    .sort((a, b) => b.savePerMonth - a.savePerMonth).slice(0, 7);
  const tips: AdvisorTip[] = [headline, ...ranked];
  const totalSavePerMonth = r2(ranked.reduce((s, t) => s + t.savePerMonth, 0));

  return {
    // legacy/compat fields
    tips, totalSavePerMonth, savingsRate: r2(rate),
    // whether there's any activity in the selected period to evaluate at all
    hasData: cur.length > 0,
    // new structured sections
    score, budget, trends: trends.slice(0, 6), anomalies, wins: wins.slice(0, 4),
    actionPlan: ranked, totalSavePerYear: r2(totalSavePerMonth * 12),
    period: { from: dates[0] || null, to: dates[dates.length - 1] || null, months: r2(mo), income: r2(income), spend: r2(spend), net: r2(net) }
  };
}

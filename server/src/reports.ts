// Reports engine — period summaries built on the existing analytics. A report
// covers a window, compares it to the immediately preceding equal window, and
// reuses advise() for insights. Supports named cadences AND arbitrary day ranges
// (e.g. "last 30 days") so the UI can generate any range on the spot.
import type { Tx, Account, Snapshot } from './store.js';
import { advise } from './analytics.js';
import { detectRecurring } from './recurring.js';
import { isMovement, isIncome } from './classifier.js';

export type Cadence = 'weekly' | 'monthly' | 'six_month' | 'year_in_review';
export const CADENCES: Cadence[] = ['weekly', 'monthly', 'six_month', 'year_in_review'];

const DAY = 864e5;
const r2 = (n: number) => Math.round(n * 100) / 100;
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
function shift(dateISO: string, days: number): string {
  const d = new Date(dateISO + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return isoOf(d);
}
function monthFirst(dateISO: string, monthsBack: number): string {
  const d = new Date(dateISO + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - monthsBack); return isoOf(d);
}
function monthLast(firstISO: string): string {
  const d = new Date(firstISO + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1, 0); return isoOf(d);
}
function nextMonth(ym: string): string {
  let [y, m] = ym.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`;
}
const pct = (cur: number, prev: number): number | null => (prev ? r2((cur - prev) / Math.abs(prev) * 100) : null);

type Grain = 'day' | 'week' | 'month';
interface Win { from: string; to: string; label: string; grain: Grain }

function windowFor(cadence: Cadence, anchor: string, offset: number): Win {
  if (cadence === 'weekly') { const to = shift(anchor, -offset * 7), from = shift(to, -6); return { from, to, label: `Week of ${from}`, grain: 'day' }; }
  if (cadence === 'monthly') { const from = monthFirst(anchor, offset), to = monthLast(from); return { from, to, label: from.slice(0, 7), grain: 'week' }; }
  if (cadence === 'six_month') { const to = shift(anchor, -offset * 182), from = shift(to, -181); return { from, to, label: `${from} → ${to}`, grain: 'month' }; }
  const to = shift(anchor, -offset * 365), from = shift(to, -364); return { from, to, label: from.slice(0, 4), grain: 'month' };
}

// Generic rolling day window — the basis for "last N days" reports.
function rangeWindow(anchor: string, days: number, offset: number): Win {
  const to = shift(anchor, -offset * days), from = shift(to, -(days - 1));
  const grain: Grain = days <= 16 ? 'day' : days <= 95 ? 'week' : 'month';
  const presets: Record<number, string> = { 7: 'Last 7 days', 30: 'Last 30 days', 90: 'Last 90 days', 182: 'Last 6 months', 180: 'Last 6 months', 365: 'Last 12 months' };
  const label = offset === 0 ? (presets[days] || `Last ${days} days`) : `${days} days ending ${to}`;
  return { from, to, label, grain };
}

const inWin = (tx: Tx[], from: string, to: string) => tx.filter(t => t.date >= from && t.date <= to);

function metrics(rows: Tx[]) {
  const income = rows.filter(isIncome).reduce((s, t) => s + t.amount, 0);
  const spend = Math.abs(rows.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0));
  const net = income - spend;
  return { income: r2(income), spend: r2(spend), net: r2(net), savingsRate: r2(income > 0 ? net / income * 100 : 0), count: rows.length };
}
function catTotals(rows: Tx[]) {
  const m: Record<string, { total: number; count: number }> = {};
  for (const t of rows) if (t.amount < 0) { (m[t.category] ||= { total: 0, count: 0 }).total += Math.abs(t.amount); m[t.category].count++; }
  return m;
}
function merchTotals(rows: Tx[]) {
  const m: Record<string, { total: number; count: number }> = {};
  for (const t of rows) if (t.amount < 0) { (m[t.merchant] ||= { total: 0, count: 0 }).total += Math.abs(t.amount); m[t.merchant].count++; }
  return m;
}
function buckets(from: string, to: string, grain: Grain): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  if (grain === 'day') { let d = from; while (d <= to) { out.push({ key: d, label: d.slice(5) }); d = shift(d, 1); } }
  else if (grain === 'week') { let d = from, i = 0; while (d <= to) { out.push({ key: 'w' + i, label: 'W' + (i + 1) }); d = shift(d, 7); i++; } }
  else { let m = from.slice(0, 7); const e = to.slice(0, 7); while (m <= e) { out.push({ key: m, label: m }); m = nextMonth(m); } }
  return out;
}
function trendSeries(rows: Tx[], from: string, to: string, grain: Grain) {
  const bs = buckets(from, to, grain);
  const idx = new Map(bs.map((b, i) => [b.key, i]));
  const series = bs.map(b => ({ label: b.label, in: 0, out: 0, net: 0 }));
  for (const t of rows) {
    const k = grain === 'day' ? t.date : grain === 'month' ? t.date.slice(0, 7) : 'w' + Math.floor((Date.parse(t.date) - Date.parse(from)) / DAY / 7);
    const i = idx.get(k); if (i == null) continue;
    if (isIncome(t)) series[i].in += t.amount; else if (t.amount < 0) series[i].out += Math.abs(t.amount);
  }
  for (const s of series) { s.in = r2(s.in); s.out = r2(s.out); s.net = r2(s.in - s.out); }
  return series;
}

// Core: build the full report payload for a resolved window.
function assemble(tx: Tx[], w: Win) {
  const span = Math.round((Date.parse(w.to) - Date.parse(w.from)) / DAY) + 1;
  const prevTo = shift(w.from, -1), prevFrom = shift(prevTo, -(span - 1));
  const cur = inWin(tx, w.from, w.to), prev = inWin(tx, prevFrom, prevTo);
  // If the prior period has no transactions at all, deltas are meaningless (they'd just
  // equal the current value). Null them out so the UI shows "—" instead of "+$1,513".
  const hasPrior = prev.length > 0;
  // Spending views exclude money movement (debt payoff, transfers, saving), which is
  // not consumption. Income (positive amounts) is kept.
  const curC = cur.filter(t => !(t.amount < 0 && isMovement(t.category)));
  const prevC = prev.filter(t => !(t.amount < 0 && isMovement(t.category)));
  const m = metrics(curC), pm = metrics(prevC);
  const cc = catTotals(curC), cp = catTotals(prevC);

  const categories = Object.keys(cc).map(name => {
    const total = r2(cc[name].total), prevTotal = r2(cp[name]?.total || 0);
    return { name, total, count: cc[name].count, prev: prevTotal, delta: hasPrior ? r2(total - prevTotal) : null, share: m.spend ? r2(total / m.spend * 100) : 0 };
  }).sort((a, b) => b.total - a.total);

  const mt = merchTotals(curC);
  const merchants = Object.entries(mt).map(([name, v]) => ({ name, total: r2(v.total), count: v.count })).sort((a, b) => b.total - a.total).slice(0, 12);
  const trend = trendSeries(curC, w.from, w.to, w.grain);
  // Income by source (positive amounts grouped by merchant/payer), mirrors the
  // spending breakdown. `trend[].in` carries income-over-time for the line graph.
  const incSrc: Record<string, { total: number; count: number }> = {};
  for (const t of curC) if (isIncome(t)) { const k = t.merchant || t.name; (incSrc[k] ||= { total: 0, count: 0 }).total += t.amount; incSrc[k].count++; }
  const incomeSources = Object.entries(incSrc).map(([name, v]) => ({ name, total: r2(v.total), count: v.count })).sort((a, b) => b.total - a.total).slice(0, 12);
  // Biggest spend GROUPS — aggregate repeated purchases by merchant (e.g. 4 CD
  // deposits => one row of -$4,000 with count 4), sorted by total outflow.
  const spendGroups: Record<string, { name: string; category: string; total: number; count: number }> = {};
  for (const t of curC) if (t.amount < 0) {
    const key = t.merchant || t.name;
    (spendGroups[key] ||= { name: key, category: t.category, total: 0, count: 0 });
    spendGroups[key].total += Math.abs(t.amount); spendGroups[key].count++;
  }
  const biggest = Object.values(spendGroups).sort((a, b) => b.total - a.total).slice(0, 6)
    .map(g => ({ date: '', name: g.name, merchant: g.name, amount: -r2(g.total), category: g.category, count: g.count }));
  const prevMerch = new Set(prevC.map(t => t.merchant));
  const newMerchants = [...new Set(curC.filter(t => t.amount < 0 && !prevMerch.has(t.merchant)).map(t => t.merchant))].slice(0, 8);
  // Subscriptions: use the real recurring-charge detector (same engine as the
  // Subscriptions page) over full history, not a category filter, so the report
  // agrees with the tracker and lists every active subscription (no 8-cap).
  const activeSubs = detectRecurring(tx).subscriptions.filter(s => s.active);
  const mk = (cv: number, pv: number, rate = false) => ({ value: cv, prev: pv, delta: hasPrior ? r2(cv - pv) : null, pct: hasPrior && !rate ? pct(cv, pv) : null });

  return {
    period: { from: w.from, to: w.to, label: w.label, days: span, grain: w.grain },
    prevPeriod: { from: prevFrom, to: prevTo },
    kpis: {
      income: mk(m.income, pm.income), spend: mk(m.spend, pm.spend), net: mk(m.net, pm.net),
      savingsRate: mk(m.savingsRate, pm.savingsRate, true), count: m.count
    },
    categories, merchants, trend, biggest, newMerchants, incomeSources,
    subscriptions: {
      count: activeSubs.length,
      names: activeSubs.map(s => s.merchant),
      items: activeSubs.map(s => ({ name: s.merchant, cadence: s.cadence, monthly: r2(s.monthlyCost), annual: r2(s.annualCost) })).sort((a, b) => b.monthly - a.monthly),
      monthly: r2(activeSubs.reduce((s, x) => s + x.monthlyCost, 0)),
      annual: r2(activeSubs.reduce((s, x) => s + x.annualCost, 0))
    },
    insights: advise(cur, 0, w.to)
  };
}

export function buildReport(tx: Tx[], cadence: Cadence, offset: number) {
  const anchor = tx.length ? tx[tx.length - 1].date : isoOf(new Date());
  return { cadence, offset, ...assemble(tx, windowFor(cadence, anchor, offset)) };
}

export function buildRangeReport(tx: Tx[], days: number, offset: number) {
  const anchor = tx.length ? tx[tx.length - 1].date : isoOf(new Date());
  return { days, offset, ...assemble(tx, rangeWindow(anchor, days, offset)) };
}

// Calendar-month report ('YYYY-MM'): the whole month, compared to the prior period
// (the equal-length window immediately before it), with a weekly trend grain.
export function buildMonthReport(tx: Tx[], ym: string) {
  const from = ym + '-01';
  const to = monthLast(from);
  return { month: ym, ...assemble(tx, { from, to, label: ym, grain: 'week' }) };
}

// Arbitrary multi-month window (e.g. a full calendar year). `fromExclusive` follows
// the app's convention (the day BEFORE the first included day); we shift to the
// inclusive start the report engine expects. A full year is labelled just "YYYY".
export function buildWindowReport(tx: Tx[], fromExclusive: string, toInclusive: string) {
  const from = shift(fromExclusive, 1);
  const to = toInclusive;
  const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  const grain: Grain = span > 95 ? 'month' : span > 16 ? 'week' : 'day';
  const isYear = /^\d{4}-01-01$/.test(from) && /^\d{4}-12-31$/.test(to) && from.slice(0, 4) === to.slice(0, 4);
  const label = isYear ? from.slice(0, 4) : `${from} to ${to}`;
  return { window: { from, to }, ...assemble(tx, { from, to, label, grain }) };
}

// Investments block: change-in-value per investment account over [from, to], from
// the balance snapshot trail. We diff the latest snapshot on/before the period end
// against the latest on/before the period start. When a boundary snapshot is missing
// (tracking just started), we report "tracking" rather than a misleading number.
// `change` is gross change in value, NOT investment return, deposits are not netted
// out; contributions are surfaced separately as context only.
export function buildInvestments(accounts: Account[], snapshots: Snapshot[], from: string, to: string, tx: Tx[]) {
  if (!accounts.length) return { hasData: false, asOf: null as string | null, totalValue: 0, totalChange: null as number | null, contributions: 0, accounts: [] as InvAcct[] };

  const byAcct: Record<string, Snapshot[]> = {};
  for (const s of snapshots) (byAcct[s.account_id] ||= []).push(s);
  for (const k in byAcct) byAcct[k].sort((a, b) => a.date < b.date ? -1 : 1);
  const latestOnOrBefore = (rows: Snapshot[], d: string): Snapshot | null => {
    let found: Snapshot | null = null;
    for (const s of rows) { if (s.date <= d) found = s; else break; }
    return found;
  };

  let asOf: string | null = null;
  const out: InvAcct[] = accounts.map(a => {
    const rows = byAcct[a.id] || [];
    const startSnap = latestOnOrBefore(rows, from);
    const endSnap = latestOnOrBefore(rows, to);
    const value = endSnap ? endSnap.balance : a.current_balance;
    if (endSnap && (!asOf || endSnap.date > asOf)) asOf = endSnap.date;
    const haveBoth = !!(startSnap && endSnap && startSnap.date !== endSnap.date);
    const start = haveBoth ? r2(startSnap!.balance) : null;
    const change = haveBoth ? r2(value - startSnap!.balance) : null;
    const changePct = (change != null && start) ? r2(change / Math.abs(start) * 100) : null;
    return { name: a.name, mask: a.mask, type: a.type, value: r2(value), start, change, changePct, tracking: !haveBoth, since: rows.length ? rows[0].date : null };
  });

  const computable = out.filter(a => a.change != null);
  const contributions = r2(Math.abs(tx
    .filter(t => t.amount < 0 && t.category === 'Savings & Investments' && t.date >= from && t.date <= to)
    .reduce((s, t) => s + t.amount, 0)));
  return {
    hasData: true,
    asOf,
    totalValue: r2(out.reduce((s, a) => s + a.value, 0)),
    totalChange: computable.length ? r2(computable.reduce((s, a) => s + (a.change || 0), 0)) : null,
    contributions,
    accounts: out
  };
}
interface InvAcct { name: string; mask: string; type: string; value: number; start: number | null; change: number | null; changePct: number | null; tracking: boolean; since: string | null; }

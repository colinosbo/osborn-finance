// Savings-goal projections. Pure functions over the user's goals + transactions.
// We never store computed fields — pace is derived at read time from the user's
// recent net cash flow, so projections stay current as new transactions land.
import type { Goal, Tx } from './store.js';

const DAY = 864e5;
const r2 = (n: number) => Math.round(n * 100) / 100;
const shiftDays = (iso: string, d: number) => { const x = new Date(iso + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

// Average monthly net cash flow (income − spending) over the trailing ~6 months
// of history. This is the money realistically available to put toward goals.
export function monthlyNetCashFlow(tx: Tx[]): number {
  if (!tx.length) return 0;
  const latest = tx[tx.length - 1].date, earliest = tx[0].date;
  const spanDays = (Date.parse(latest) - Date.parse(earliest)) / DAY;
  const windowDays = Math.min(183, Math.max(30, Math.ceil(spanDays) || 30));
  const cutoff = shiftDays(latest, -windowDays);
  const net = tx.filter(t => t.date > cutoff).reduce((s, t) => s + t.amount, 0);
  return r2(net / Math.max(1, windowDays / 30.44));
}

export interface GoalView extends Goal {
  remaining: number;
  pctComplete: number;             // 0..100
  monthlyNet: number;              // contribution rate we project from
  monthsToGoal: number | null;     // null when not progressing
  projectedDate: string | null;    // ISO date goal is reached at current pace
  onTrack: boolean | null;         // vs target_date; null when no target_date
  requiredMonthly: number | null;  // monthly amount needed to hit target_date
  status: 'reached' | 'on_track' | 'behind' | 'stalled' | 'no_target';
}

export function projectGoals(goals: Goal[], tx: Tx[]) {
  const monthlyNet = monthlyNetCashFlow(tx);
  const anchor = tx.length ? tx[tx.length - 1].date : new Date().toISOString().slice(0, 10);

  const views: GoalView[] = goals.map(g => {
    const remaining = r2(Math.max(0, g.target_amount - g.saved_amount));
    const pctComplete = g.target_amount > 0 ? Math.min(100, r2(g.saved_amount / g.target_amount * 100)) : 0;
    const reached = remaining <= 0;

    let monthsToGoal: number | null = null, projectedDate: string | null = null;
    if (reached) { monthsToGoal = 0; projectedDate = anchor; }
    else if (monthlyNet > 0) {
      monthsToGoal = r2(remaining / monthlyNet);
      projectedDate = shiftDays(anchor, Math.round(monthsToGoal * 30.44));
    }

    let requiredMonthly: number | null = null, onTrack: boolean | null = null;
    if (g.target_date) {
      const monthsLeft = (Date.parse(g.target_date) - Date.parse(anchor)) / DAY / 30.44;
      requiredMonthly = monthsLeft > 0 ? r2(remaining / monthsLeft) : remaining;
      onTrack = reached ? true : (projectedDate ? projectedDate <= g.target_date : false);
    }

    let status: GoalView['status'];
    if (reached) status = 'reached';
    else if (monthlyNet <= 0) status = 'stalled';
    else if (g.target_date) status = onTrack ? 'on_track' : 'behind';
    else status = 'no_target';

    return { ...g, remaining, pctComplete, monthlyNet, monthsToGoal, projectedDate, onTrack, requiredMonthly, status };
  });

  return {
    goals: views,
    totals: {
      count: views.length,
      saved: r2(views.reduce((s, v) => s + v.saved_amount, 0)),
      target: r2(views.reduce((s, v) => s + v.target_amount, 0)),
      monthlyNet
    }
  };
}

import { useEffect, useState } from 'react';
import { api, fmt, fmt0, fmtDate } from './api';
import { loadPrefs } from './prefs';

interface Debt { account_id: string; name: string; mask: string; type: string; balance: number; apr: number; minPayment: number }
interface Step { account_id: string; name: string; order: number; payoffMonth: number; payoffDate: string; interestPaid: number }
interface Plan { months: number; totalInterest: number; debtFreeDate: string; steps: Step[]; feasible: boolean }
interface DebtResp {
  debts: Debt[]; totalDebt: number; totalMin: number; avgApr: number;
  monthlyProfit: number; suggestedExtra: number; extra: number;
  avalanche: Plan | null; snowball: Plan | null; minimumsOnly: Plan | null;
  recommended: string; interestSavedVsMinimum: number;
}

export default function DebtPlan() {
  const df = loadPrefs().dateFormat;
  const [data, setData] = useState<DebtResp | null>(null);
  const [pos, setPos] = useState<number | null>(null);

  const load = (ex?: number) => api<DebtResp>(`/api/debt${ex != null ? `?extra=${ex}` : ''}`).then(setData).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { if (data && pos === null) setPos(data.suggestedExtra); }, [data, pos]);
  // debounce the slider so dragging doesn't spam the server
  useEffect(() => { if (pos === null) return; const t = setTimeout(() => load(pos), 280); return () => clearTimeout(t); }, [pos]);

  if (!data || !data.debts.length) return null; // no debt section unless there are debts

  // Always use the lowest-cost order (clear the highest-interest debt first).
  const plan = data.avalanche!;
  const curExtra = pos ?? data.extra;
  const months = plan.months;
  const dur = (Math.floor(months / 12) ? `${Math.floor(months / 12)}y ` : '') + `${months % 12}m`;
  const savedVsMin = data.minimumsOnly && plan.feasible && data.minimumsOnly.feasible
    ? Math.max(0, Math.round(data.minimumsOnly.totalInterest - plan.totalInterest)) : 0;
  const sliderMax = Math.max(2000, Math.round(data.suggestedExtra * 2 / 25) * 25);

  return (
    <div className="debt-wrap">
      <div className="sec-head" style={{ marginTop: 12 }}><span className="sec-num">◆</span><span className="sec-title">Debt <span className="grad">payoff plan</span></span></div>
      <div className="sec-sub">Every loan and card in one place, with a plan built from your monthly profit</div>

      <div className="cards" style={{ marginBottom: 24 }}>
        <div className="card"><div className="label">Total debt</div><div className="value red">{fmt0(data.totalDebt)}</div><div className="detail">{data.debts.length} account{data.debts.length === 1 ? '' : 's'} · avg {data.avgApr}% APR est.</div></div>
        <div className="card"><div className="label">Monthly profit</div><div className={'value ' + (data.monthlyProfit >= 0 ? 'green' : 'red')}>{fmt0(data.monthlyProfit)}</div><div className="detail">spare cash flow to attack debt</div></div>
        <div className="card"><div className="label">Debt-free date</div><div className="value" style={{ fontSize: 22 }}>{plan.feasible ? fmtDate(plan.debtFreeDate, df) : 'Out of reach'}</div><div className="detail">{plan.feasible ? `${dur} at ${fmt0(curExtra)}/mo extra` : 'payments barely cover interest'}</div></div>
        <div className="card"><div className="label">Interest you'll pay</div><div className="value">{fmt0(plan.totalInterest)}</div><div className="detail">{savedVsMin > 0 ? `saves ${fmt0(savedVsMin)} vs minimums only` : 'on this plan'}</div></div>
      </div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <div className="debt-ctl-lbl">Extra toward debt each month</div>
        <div className="debt-extra-row">
          <input type="range" min={0} max={sliderMax} step={25} value={curExtra} onChange={e => setPos(+e.target.value)} />
          <span className="debt-extra-val">{fmt0(curExtra)}<i>/mo</i></span>
        </div>
        <div className="debt-ctl-hint">Starts at your monthly profit ({fmt0(data.suggestedExtra)}). Drag to see how a bigger payment speeds things up. We pay down your highest-interest debt first so you spend the least on interest.</div>
      </div>

      <div className="panel">
        <h3>Your debts</h3>
        <div className="psub">Listed in payoff order, most expensive debt first. APR is estimated from each account type.</div>
        {plan.steps.map(s => {
          const d = data.debts.find(x => x.account_id === s.account_id);
          if (!d) return null;
          return (
            <div className="debt-row" key={s.account_id}>
              <span className="debt-order" style={{ opacity: plan.feasible ? 1 : 0.5 }}>{s.order}</span>
              <div className="debt-meta">
                <b>{d.name}{d.mask ? ` ··${d.mask}` : ''}</b>
                <span>{Math.round(d.apr * 100)}% APR est. · min {fmt0(d.minPayment)}/mo</span>
              </div>
              <div className="debt-bal">
                <b>{fmt(d.balance)}</b>
                <span>{plan.feasible ? `clear by ${fmtDate(s.payoffDate, df)}` : 'not covered'}</span>
              </div>
            </div>
          );
        })}
        <div className="debt-foot">Estimates only, not financial advice. Connect the real accounts (or adjust as you learn the true rates) for an exact plan.</div>
      </div>
    </div>
  );
}

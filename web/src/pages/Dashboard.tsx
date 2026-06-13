import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt, fmt0, color } from '../api';
import DashboardLanding from '../DashboardLanding';

interface Summary {
  range: { from: string | null; to: string | null; count: number };
  income: number; spend: number; net: number;
  avgMonthly: { value: number; excluded: number; excludedSum: number; months: number };
  categories: { name: string; total: number; count: number }[];
  merchants: { name: string; total: number; count: number }[];
  monthly: { month: string; in: number; out: number }[];
}
const RANGES = [[30, 'Last Month'], [91, '3 Months'], [182, '6 Months'], [365, 'Last Year'], [0, 'All Time']] as const;

export default function Dashboard() {
  const [days, setDays] = useState(365);
  const [s, setS] = useState<Summary | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api<Summary>(`/api/summary?days=${days}`).then(setS).catch(e => setErr(e.message)); }, [days]);
  if (err) return <div className="empty">Error: {err}</div>;
  if (!s) return <div className="empty">Loading…</div>;
  if (!s.range.count) return <DashboardLanding />;
  const maxCat = s.categories[0]?.total || 1;
  const maxBar = Math.max(...s.monthly.map(m => Math.max(m.in, m.out)), 1);
  return (
    <>
      <div className="sec-head"><span className="sec-num">01</span><span className="sec-title">Overview</span></div>
      <div className="sec-sub">{s.range.count} transactions · {s.range.from} — {s.range.to}</div>
      <div className="controls">
        {RANGES.map(([d, l]) => <button key={d} className={'btn' + (days === d ? ' primary' : '')} onClick={() => setDays(d)}>{l}</button>)}
      </div>
      <div className="cards">
        <Link to="/ledger?flow=in" style={{ textDecoration: 'none', color: 'inherit' }}><div className="card"><div className="label">Income →</div><div className="value green">{fmt(s.income)}</div><div className="detail">deposits in period</div></div></Link>
        <Link to="/ledger?flow=out" style={{ textDecoration: 'none', color: 'inherit' }}><div className="card"><div className="label">Spending →</div><div className="value">{fmt(s.spend)}</div><div className="detail">outflow in period</div></div></Link>
        <div className="card"><div className="label">Net Change</div><div className={'value ' + (s.net >= 0 ? 'green' : 'red')}>{s.net >= 0 ? '+' : ''}{fmt(s.net)}</div><div className="detail">{s.net >= 0 ? 'saved this period' : 'spent more than earned'}</div></div>
        <div className="card"><div className="label">Avg Monthly Spend</div><div className="value red">{fmt(s.avgMonthly.value)}</div><div className="detail">{s.avgMonthly.excluded ? `excluding ${s.avgMonthly.excluded} outlier(s) (${fmt0(s.avgMonthly.excludedSum)})` : `true average, last ${s.avgMonthly.months} months`}</div></div>
      </div>
      <div className="row2">
        <div className="panel">
          <h3>Where it goes</h3><div className="psub">Spending by category</div>
          {s.categories.map(c => (
            <div className="lrow" key={c.name}>
              <span style={{ width: 9, height: 9, background: color(c.name), flexShrink: 0 }} />
              <span className="name">{c.name}</span>
              <span style={{ color: 'var(--faint)', fontSize: 11 }}>×{c.count}</span>
              <span className="bar" style={{ width: Math.max(4, c.total / maxCat * 110), background: color(c.name) }} />
              <span className="val">{fmt(c.total)}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h3>Cash flow</h3><div className="psub">Monthly income vs spending</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height: 220, overflowX: 'auto' }}>
            {s.monthly.map(m => (
              <div key={m.month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 1, minWidth: 52 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 175 }}>
                  <div title={fmt0(m.in)} style={{ width: 18, height: Math.max(2, m.in / maxBar * 170), background: 'var(--green)' }} />
                  <div title={fmt0(m.out)} style={{ width: 18, height: Math.max(2, m.out / maxBar * 170), background: 'var(--v600)' }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--faint)' }}>{m.month.slice(2).replace('-', '/')}</span>
              </div>
            ))}
          </div>
          <h3 style={{ marginTop: 22 }}>Top merchants</h3>
          {s.merchants.slice(0, 6).map(m => (
            <div className="lrow" key={m.name}><span className="name">{m.name}</span><span style={{ color: 'var(--faint)', fontSize: 11 }}>×{m.count}</span><span className="val">{fmt(m.total)}</span></div>
          ))}
        </div>
      </div>
    </>
  );
}

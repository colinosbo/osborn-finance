import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt, fmt0, color, planLabel, donutData } from '../api';
import DashboardLanding from '../DashboardLanding';
import EmptyState from '../EmptyState';
import RangePicker, { DEFAULT_RANGE, rangeQS, type RangeOpt } from '../RangePicker';

interface Summary {
  hasAny: boolean;
  range: { from: string | null; to: string | null; count: number };
  income: number; spend: number; net: number;
  avgMonthly: { value: number; excluded: number; excludedSum: number; months: number };
  categories: { name: string; total: number; count: number }[];
  merchants: { name: string; total: number; count: number }[];
  monthly: { month: string; in: number; out: number }[];
}
interface Me { plan: string; items: { id: string }[] }

// Paid users with no transactions yet shouldn't see the marketing pitch, they
// already bought. Show a focused "connect your bank" onboarding instead.
function ConnectPrompt({ plan, hasBank }: { plan: string; hasBank: boolean }) {
  return (
    <EmptyState
      icon="bank"
      eyebrow={`You're on ${planLabel(plan)}`}
      title={hasBank ? 'Your bank is linked, transactions are on the way' : 'Connect your bank to see your money'}
      sub={hasBank
        ? "We're syncing your accounts. New transactions will appear here automatically. You can trigger a sync now, or import a CSV to get started immediately."
        : 'Link your accounts securely through Plaid and Covisor pulls in your transactions, auto-categorizes them, and builds your dashboard in seconds. Prefer a file? Import a CSV instead.'}
      cta={{ to: '/accounts', label: hasBank ? 'Go to Accounts' : 'Connect a bank' }}
      secondary={{ to: '/accounts', label: 'Import CSV' }}
      hints={[
        { icon: 'lock', label: 'Bank-level encryption' },
        { icon: 'repeat', label: 'Auto-syncs your spending' },
        { icon: 'reports', label: 'Reports, PDFs & insights' }
      ]}
    />
  );
}

// Spending-by-category donut (the circle graph used across the app).
function Donut({ cats, total }: { cats: { name: string; total: number }[]; total: number }) {
  const data = donutData(cats, 9);
  const sum = data.reduce((sm, d) => sm + d.total, 0) || 1;
  const r = 56, sw = 24, circ = 2 * Math.PI * r; let acc = 0;
  return (
    <div className="donut">
      <svg width="156" height="156" viewBox="0 0 156 156">
        <g transform="rotate(-90 78 78)">
          <circle cx="78" cy="78" r={r} fill="none" stroke="var(--hairline)" strokeWidth={sw} />
          {data.map(d => {
            const len = (d.total / sum) * circ;
            const seg = <circle key={d.name} cx="78" cy="78" r={r} fill="none" stroke={color(d.name)} strokeWidth={sw} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-acc} strokeLinecap="butt" />;
            acc += len; return seg;
          })}
        </g>
      </svg>
      <div className="donut-center"><span>SPENT</span><b>{fmt0(total)}</b></div>
    </div>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState<RangeOpt>(DEFAULT_RANGE);
  const [s, setS] = useState<Summary | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [err, setErr] = useState('');
  const [accounts, setAccounts] = useState<string[]>([]);
  const [acctFilter, setAcctFilter] = useState('');
  useEffect(() => { api<string[]>('/api/tx-accounts').then(setAccounts).catch(() => {}); }, []);
  useEffect(() => {
    const qs = rangeQS(range) + (acctFilter ? `&accounts=${encodeURIComponent(acctFilter)}` : '');
    api<Summary>(`/api/summary?${qs}`).then(setS).catch(e => setErr(e.message));
  }, [range, acctFilter]);
  useEffect(() => { api<Me>('/api/me').then(setMe).catch(() => setMe({ plan: 'free', items: [] })); }, []);
  if (err) return <div className="empty">Error: {err}</div>;
  if (!s || !me) return <div className="empty">Loading…</div>;
  if (!s.hasAny) return me.plan === 'free'
    ? <DashboardLanding />
    : <ConnectPrompt plan={me.plan} hasBank={(me.items?.length ?? 0) > 0} />;
  const maxCat = s.categories[0]?.total || 1;
  return (
    <>
      <div className="sec-head"><span className="sec-num">01</span><span className="sec-title">Overview</span></div>
      <div className="sec-sub">{s.range.count ? `${s.range.count} transactions · ${s.range.from} to ${s.range.to}` : 'No activity in the selected range'}</div>
      <div className="controls">
        <RangePicker value={range.value} onChange={setRange} />
        {accounts.length > 1 && (
          <select value={acctFilter} onChange={e => setAcctFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>
      {s.range.count === 0 ? (
        <EmptyState icon="dashboard" eyebrow="Overview" title="No activity in this range" sub="You have transactions, just none in this window. Pick a different range or month above." cta={null} secondary={null} />
      ) : (
      <>
      <div className="cards">
        <Link to={`/ledger?flow=in&${rangeQS(range)}`} style={{ textDecoration: 'none', color: 'inherit' }}><div className="card"><div className="label">Income →</div><div className="value green">{fmt(s.income)}</div><div className="detail">deposits in period</div></div></Link>
        <Link to={`/ledger?flow=out&${rangeQS(range)}`} style={{ textDecoration: 'none', color: 'inherit' }}><div className="card"><div className="label">Spending →</div><div className="value">{fmt(s.spend)}</div><div className="detail">outflow in period</div></div></Link>
        <div className="card"><div className="label">Net Change</div><div className={'value ' + (s.net >= 0 ? 'green' : 'red')}>{s.net >= 0 ? '+' : ''}{fmt(s.net)}</div><div className="detail">{s.net >= 0 ? 'saved this period' : 'spent more than earned'}</div></div>
        <div className="card"><div className="label">Avg Monthly Spend</div><div className="value red">{fmt(s.avgMonthly.value)}</div><div className="detail">{s.avgMonthly.excluded ? `excluding ${s.avgMonthly.excluded} outlier(s) (${fmt0(s.avgMonthly.excludedSum)})` : `true average, last ${s.avgMonthly.months} months`}</div></div>
      </div>
      <div className="row2">
        <div className="panel">
          <h3>Where it goes</h3><div className="psub">Spending by category</div>
          {s.categories.length > 0 && <Donut cats={s.categories} total={s.spend} />}
          {s.categories.map(c => (
            <Link key={c.name} to={`/ledger?cat=${encodeURIComponent(c.name)}&${rangeQS(range)}`} className="lrow lrow-link" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span style={{ width: 9, height: 9, background: color(c.name), flexShrink: 0 }} />
              <span className="name">{c.name}</span>
              <span style={{ color: 'var(--faint)', fontSize: 11 }}>×{c.count}</span>
              <span className="bar" style={{ width: Math.max(4, c.total / maxCat * 110), background: color(c.name) }} />
              <span className="val">{fmt(c.total)}</span>
            </Link>
          ))}
        </div>
        <div className="panel">
          <h3>Top merchants</h3><div className="psub">Where the money went</div>
          {s.merchants.slice(0, 10).map(m => (
            <Link key={m.name} to={`/ledger?open=${encodeURIComponent(m.name)}&${rangeQS(range)}`} className="lrow lrow-link" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="name">{m.name}</span><span style={{ color: 'var(--faint)', fontSize: 11 }}>×{m.count}</span><span className="val">{fmt(m.total)}</span>
            </Link>
          ))}
        </div>
      </div>
      </>
      )}
    </>
  );
}

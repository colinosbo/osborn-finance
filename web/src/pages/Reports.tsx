import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmt, fmt0, color, donutData } from '../api';
import { generateReportPDF } from '../pdf';
import type { Toast } from '../App';
import EmptyState from '../EmptyState';
import RangePicker, { DEFAULT_RANGE, rangeQS, type RangeOpt } from '../RangePicker';
import { buildFacts } from '../facts';

interface Kpi { value: number; prev: number; delta: number | null; pct: number | null }
interface Cat { name: string; total: number; count: number; prev: number; delta: number | null; share: number }
interface Report {
  month?: string;
  period: { from: string; to: string; label: string; days: number; grain: string };
  kpis: { income: Kpi; spend: Kpi; net: Kpi; savingsRate: Kpi; count: number };
  categories: Cat[];
  merchants: { name: string; total: number; count: number }[];
  trend: { label: string; in: number; out: number; net: number }[];
  biggest: { date: string; name: string; merchant: string; amount: number; category: string; count?: number }[];
  newMerchants: string[];
  incomeSources: { name: string; total: number; count: number }[];
  subscriptions: { count: number; names: string[]; monthly: number; annual: number; items: { name: string; cadence: string; monthly: number; annual: number }[] };
  insights: { tips: { icon: string; title: string; text: string; savePerMonth: number; pinned?: boolean }[]; totalSavePerMonth: number; savingsRate: number };
  investments?: {
    hasData: boolean; asOf: string | null; totalValue: number; totalChange: number | null; contributions: number;
    accounts: { name: string; mask: string; type: string; value: number; start: number | null; change: number | null; changePct: number | null; tracking: boolean; since: string | null }[];
  };
}
type Sections = {
  kpis: boolean; donut: boolean;
  categories: boolean; income: boolean; insights: boolean; topSpending: boolean; subscriptions: boolean; investments: boolean;
};
interface RP { topN: number; sections: Sections }

// Thin-stroke icons for the report action bar — match the app's editorial icon set.
const AIcon = ({ d, spin }: { d: JSX.Element; spin?: boolean }) => (
  <svg className={spin ? 'spin' : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
);
const ICO = {
  refresh: <><path d="M21 12a9 9 0 1 1-2.64-6.36" /><polyline points="21 3 21 9 15 9" /></>,
  csv: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  pdf: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></>,
};

const RKEY = 'of_report_prefs';
const DEFAULT_RP: RP = {
  topN: 8,
  sections: { kpis: true, donut: true, categories: true, income: true, insights: true, topSpending: true, subscriptions: true, investments: true }
};
const loadRP = (): RP => {
  try {
    const stored = JSON.parse(localStorage.getItem(RKEY) || '{}');
    // Only carry over keys that exist in DEFAULT — avoids stale keys inflating counts
    const sections: Sections = { ...DEFAULT_RP.sections };
    if (stored.sections) {
      (Object.keys(DEFAULT_RP.sections) as (keyof Sections)[]).forEach(k => {
        if (k in stored.sections) sections[k] = stored.sections[k];
      });
    }
    return { ...DEFAULT_RP, ...stored, sections };
  } catch { return { ...DEFAULT_RP }; }
};
const saveRP = (rp: RP) => localStorage.setItem(RKEY, JSON.stringify(rp));

// Same dimensions as the Dashboard donut — 156×156, center 78,78, r=56, sw=24
function Donut({ cats, total }: { cats: Cat[]; total: number }) {
  const data = donutData(cats, 9);
  const sum = data.reduce((s, d) => s + d.total, 0) || 1;
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

function Delta({ k, goodUp, rate }: { k: Kpi; goodUp: boolean; rate?: boolean }) {
  // null delta = no prior-period data; show a dash rather than a misleading "+$X vs prior"
  if (k.delta == null) return <div className="delta flat">—</div>;
  if (!k.prev && !k.delta) return <div className="delta flat">—</div>;
  const up = k.delta >= 0, good = up === goodUp;
  const txt = rate
    ? `${k.delta > 0 ? '+' : ''}${k.delta} pts`
    : `${k.delta > 0 ? '+' : ''}${fmt0(k.delta)}${k.pct != null ? ` (${k.pct > 0 ? '+' : ''}${k.pct}%)` : ''}`;
  return <div className={'delta ' + (good ? 'good' : 'bad')}>{up ? '▲' : '▼'} {txt} <span className="delta-vs">vs prior</span></div>;
}

function Toggle({ label, on, onToggle, sub, indent }: { label: string; on: boolean; onToggle: () => void; sub?: string; indent?: boolean }) {
  return (
    <div
      onClick={onToggle}
      style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--hairline)', paddingLeft: indent ? 14 : 0, cursor: 'pointer', userSelect: 'none' }}
    >
      <div>
        <div style={{ fontSize: 13, fontWeight: indent ? 400 : 550, color: on ? 'var(--ink)' : 'var(--faint)', transition: 'color 0.15s' }}>{label}</div>
        {sub && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{sub}</div>}
      </div>
      <span role="switch" aria-checked={on} className={'rtoggle' + (on ? ' on' : '')}><b /></span>
    </div>
  );
}

export default function Reports({ toast }: { toast: Toast }) {
  const [rp, setRp] = useState<RP>(loadRP);
  const [range, setRange] = useState<RangeOpt>(DEFAULT_RANGE);
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  // acctSel: which accounts are checked. Initialized to all once /api/tx-accounts loads.
  const [acctSel, setAcctSel] = useState<Set<string>>(new Set());
  // Track whether acctSel has been seeded so the effect doesn't fire before load.
  const acctSeeded = useRef(false);

  useEffect(() => {
    api<string[]>('/api/tx-accounts').then(names => {
      setAccounts(names);
      setAcctSel(new Set(names)); // all checked by default
      acctSeeded.current = true;
    }).catch(() => { acctSeeded.current = true; });
  }, []);

  const toggleAcct = (name: string) =>
    setAcctSel(prev => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next; });
  const allChecked = accounts.length === 0 || acctSel.size === accounts.length;

  const update = (patch: Partial<RP>) => { const next = { ...rp, ...patch }; setRp(next); saveRP(next); };
  const setSection = (k: keyof Sections) => update({ sections: { ...rp.sections, [k]: !rp.sections[k] } });
  const s = rp.sections;

  // Comma-separated account names when filtering a subset; empty string = all
  const acctParam = !allChecked && acctSel.size > 0 ? [...acctSel].sort().join(',') : '';

  const fetchReport = useCallback(() => {
    if (!range.from) { setLoading(false); return; } // BUG-7 fix: don't leave spinner stuck
    setLoading(true);
    const url = `/api/reports?${rangeQS(range)}${acctParam ? `&accounts=${encodeURIComponent(acctParam)}` : ''}`;
    api<Report>(url)
      .then(r => { setRep(r); setLoading(false); })
      .catch(() => setLoading(false));
  }, [range, acctParam]);
  useEffect(() => { fetchReport(); }, [fetchReport]);
  useEffect(() => {
    api<{ months: string[] }>('/api/tx-months')
      .then(r => { if (!r.months?.length) { setNoData(true); setLoading(false); } })
      .catch(() => setLoading(false));
  }, []);

  const downloadCSV = () => {
    if (!rep) return;
    const lines = ['Section,Name,Amount,Count,Share %,Delta vs prior'];
    lines.push(`KPI,Income,${rep.kpis.income.value},,,${rep.kpis.income.delta}`);
    lines.push(`KPI,Spend,${rep.kpis.spend.value},,,${rep.kpis.spend.delta}`);
    lines.push(`KPI,Net,${rep.kpis.net.value},,,${rep.kpis.net.delta}`);
    rep.categories.forEach(c => lines.push(`Category,"${c.name}",${c.total},${c.count},${c.share},${c.delta}`));
    rep.biggest.forEach(b => lines.push(`TopSpending,"${b.name}",${b.amount},${b.count || 1},,`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `covisor-report-${rep.month || rep.period.from}.csv`; a.click();
    toast('CSV downloaded');
  };

  // Only count canonical section keys — guards against stale localStorage keys.
  const activeSectionCount = (Object.keys(DEFAULT_RP.sections) as (keyof Sections)[]).filter(k => s[k]).length;
  const totalSections = Object.keys(DEFAULT_RP.sections).length;

  if (noData) return (
    <>
      <div className="sec-head"><span className="sec-num">06</span><span className="sec-title">Reports</span></div>
      <EmptyState icon="chart" eyebrow="Reports" title="No activity yet" sub="Link a bank account or import a CSV to start generating reports." cta={{ to: '/accounts', label: 'Connect a bank' }} />
    </>
  );

  return (
    <>
      <div className="sec-head"><span className="sec-num">06</span><span className="sec-title">Reports</span></div>
      <div className="sec-sub">Customize your report — toggle sections on and off, the preview updates live</div>

      {/* Controls row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <div className="controls" style={{ marginBottom: 0 }}>
          <RangePicker value={range.value} onChange={setRange} />
        </div>
        <div className="rep-actions">
          <button className="rep-act" onClick={fetchReport} disabled={loading} title="Refresh the preview">
            <AIcon d={ICO.refresh} spin={loading} /> {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <button className="rep-act" disabled={!rep} onClick={downloadCSV} title="Export the raw figures as CSV">
            <AIcon d={ICO.csv} /> Export CSV
          </button>
          <button className="rep-act" disabled={!rep} onClick={() => toast('Email delivery arrives in the next update')} title="Email this report to yourself">
            <AIcon d={ICO.mail} /> Email me
          </button>
          <span className="rep-actsep" aria-hidden />
          <button className="rep-act primary" disabled={!rep}
            onClick={() => { if (rep) { toast('Building PDF…'); generateReportPDF(rep, { sections: rp.sections, topN: rp.topN }).then(() => toast('PDF downloaded')).catch(() => toast('PDF failed')); } }}
            title="Download the styled PDF report">
            <AIcon d={ICO.pdf} /> Download PDF
          </button>
        </div>
      </div>

      {/* Full-width report letterhead — spans both columns */}
      {rep && rep.kpis.count > 0 && (
        <div className="rep-doc-head">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div className="rdh-brand">Co<span className="grad">visor</span></div>
              <div className="rdh-title">{/^\d{4}$/.test(rep.period.label) ? 'Annual' : 'Monthly'} Spending Report</div>
              <div className="rdh-sub">{rep.period.label} &middot; {rep.period.from} to {rep.period.to} &middot; {rep.period.days} days &middot; {rep.kpis.count} transactions</div>
            </div>
            <div className="rdh-live">
              <span className="rdh-livedot" />
              Live Preview &middot; {activeSectionCount}/{totalSections} sections
            </div>
          </div>
        </div>
      )}

      {/* Two-column layout — sidebar aligns with KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>

        {/* ── Sidebar ── */}
        <div style={{ position: 'sticky', top: 80 }}>
          <div className="panel" style={{ padding: '22px 22px 20px' }}>
            <h3 style={{ marginBottom: 2 }}>Report Sections</h3>
            <div className="psub">Toggle what appears in your report</div>

            <Toggle label="Summary KPIs" sub="Income, spending, net, savings rate" on={s.kpis} onToggle={() => setSection('kpis')} />
            <Toggle label="Spending by Category" sub="Bar chart with percentage breakdown" on={s.categories} onToggle={() => setSection('categories')} />
            <Toggle label="Donut chart" sub="Visual ring of category distribution" on={s.donut} onToggle={() => setSection('donut')} indent />
            <Toggle label="Income" sub="Income broken down by source" on={s.income} onToggle={() => setSection('income')} />
            <Toggle label="AI Insights" sub="Personalized tips from your data" on={s.insights} onToggle={() => setSection('insights')} />
            <Toggle label="Top Spending" sub="Biggest merchants this period" on={s.topSpending} onToggle={() => setSection('topSpending')} />
            <Toggle label="Subscriptions" sub="Recurring charges detected" on={s.subscriptions} onToggle={() => setSection('subscriptions')} />
            <Toggle label="Investments" sub="Account values and change this period" on={s.investments} onToggle={() => setSection('investments')} />

            <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--hairline)' }}>
              <label className="fld" style={{ marginBottom: 0 }}>
                <span>Rows per section</span>
                <select value={rp.topN} onChange={e => update({ topN: +e.target.value })}>
                  {[5, 8, 10, 15, 25].map(n => <option key={n} value={n}>Top {n}</option>)}
                </select>
              </label>
            </div>

            {rep && (
              <div style={{ marginTop: 16, padding: '12px 14px', background: 'var(--hairline)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>This period</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 6, columnGap: 12, fontSize: 12 }}>
                  <span style={{ color: 'var(--faint)' }}>Income</span>
                  <span style={{ fontWeight: 700, textAlign: 'right', color: 'var(--green)' }}>{fmt0(rep.kpis.income.value)}</span>
                  <span style={{ color: 'var(--faint)' }}>Spent</span>
                  <span style={{ fontWeight: 700, textAlign: 'right' }}>{fmt0(rep.kpis.spend.value)}</span>
                  <span style={{ color: 'var(--faint)' }}>Net</span>
                  <span style={{ fontWeight: 700, textAlign: 'right', color: rep.kpis.net.value >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmt0(rep.kpis.net.value)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Account filter panel — only shown when the user has 2+ accounts */}
          {accounts.length > 1 && (
            <div className="panel" style={{ padding: '22px 22px 20px', marginTop: 16 }}>
              <h3 style={{ marginBottom: 2 }}>Accounts</h3>
              <div className="psub" style={{ marginBottom: 10 }}>Filter this report by account</div>
              {/* Select/deselect all */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--hairline)', marginBottom: 6, cursor: 'pointer', fontSize: 13, fontWeight: 550 }}>
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => setAcctSel(allChecked ? new Set() : new Set(accounts))}
                  style={{ accentColor: 'var(--v600)', width: 14, height: 14 }}
                />
                All accounts
              </label>
              {accounts.map(a => (
                <label key={a} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', cursor: 'pointer', fontSize: 13, color: acctSel.has(a) ? 'var(--ink)' : 'var(--faint)', transition: 'color 0.15s' }}>
                  <input
                    type="checkbox"
                    checked={acctSel.has(a)}
                    onChange={() => toggleAcct(a)}
                    style={{ accentColor: 'var(--v600)', width: 14, height: 14, flexShrink: 0 }}
                  />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* ── Preview ── */}
        <div style={{ opacity: loading ? 0.65 : 1, transition: 'opacity 0.2s', minWidth: 0 }}>

          {loading && !rep ? (
            <div className="panel">
              <div className="skeleton" style={{ width: '40%', marginBottom: 16 }} />
              <div className="skeleton" style={{ height: 80, marginBottom: 10 }} />
              <div className="skeleton" style={{ height: 80 }} />
            </div>
          ) : !rep || rep.kpis.count === 0 ? (
            <div className="panel empty">No transactions in this period — try a different month.</div>
          ) : (
            <>
              {/* KPI cards */}
              {s.kpis && (
                <div className="cards" style={{ marginBottom: 24 }}>
                  <div className="card">
                    <div className="label">Income</div>
                    <div className="value green">{fmt0(rep.kpis.income.value)}</div>
                    <Delta k={rep.kpis.income} goodUp />
                  </div>
                  <div className="card">
                    <div className="label">Spending</div>
                    <div className="value">{fmt0(rep.kpis.spend.value)}</div>
                    <Delta k={rep.kpis.spend} goodUp={false} />
                  </div>
                  <div className="card">
                    <div className="label">Net</div>
                    <div className={'value ' + (rep.kpis.net.value < 0 ? 'red' : 'green')}>{fmt0(rep.kpis.net.value)}</div>
                    <Delta k={rep.kpis.net} goodUp />
                  </div>
                  <div className="card">
                    <div className="label">Savings Rate</div>
                    <div className="value">{rep.kpis.savingsRate.value}%</div>
                    <Delta k={rep.kpis.savingsRate} goodUp rate />
                  </div>
                </div>
              )}

              {/* Spending by Category — full width, donut centered */}
              {s.categories && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <h3>Spending by Category</h3>
                  <div className="psub">How your {fmt0(rep.kpis.spend.value)} in spending breaks down vs the prior period</div>

                  {s.donut && rep.categories.length > 0 && (
                    <>
                      <Donut cats={rep.categories} total={rep.kpis.spend.value} />
                      {/* Color legend */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '5px 14px', marginBottom: 20, marginTop: 4 }}>
                        {rep.categories.slice(0, rp.topN).map(c => (
                          <span key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--faint)' }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: color(c.name), display: 'inline-block', flexShrink: 0 }} />
                            {c.name}
                          </span>
                        ))}
                      </div>
                    </>
                  )}

                  {rep.categories.length === 0
                    ? <div className="empty">No spending categorized this period.</div>
                    : rep.categories.slice(0, rp.topN).map(c => (
                      <div className="catrow" key={c.name}>
                        <div className="cat-top">
                          <span className="cat-name"><i style={{ background: color(c.name) }} />{c.name}</span>
                          <span className="cat-amt">{fmt(c.total)} <span className="cat-share">{c.share}%</span></span>
                        </div>
                        <div className="catbar-track"><div className="catbar-fill" style={{ width: Math.min(100, c.share) + '%', background: color(c.name) }} /></div>
                        {!!c.delta && <span className={'cat-delta ' + (c.delta > 0 ? 'bad' : 'good')}>{c.delta > 0 ? '▲' : '▼'} {fmt0(Math.abs(c.delta))} vs prior</span>}
                      </div>
                    ))
                  }
                </div>
              )}

              {/* Income — breakdown by source (mirrors expenses, no chart) */}
              {s.income && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <h3>Income</h3>
                  <div className="psub">Your {fmt0(rep.kpis.income.value)} in income this period, by source</div>
                  {rep.incomeSources.length === 0
                    ? <div className="empty">No income recorded this period.</div>
                    : (() => {
                      const max = Math.max(...rep.incomeSources.map(v => v.total), 1);
                      return rep.incomeSources.slice(0, rp.topN).map(src => (
                        <div className="catrow" key={src.name}>
                          <div className="cat-top">
                            <span className="cat-name"><i style={{ background: 'var(--green)' }} />{src.name}</span>
                            <span className="cat-amt" style={{ color: 'var(--green)' }}>{fmt(src.total)}{src.count > 1 ? <span className="cat-share">×{src.count}</span> : null}</span>
                          </div>
                          <div className="catbar-track"><div className="catbar-fill" style={{ width: Math.max(2, (src.total / max) * 100) + '%', background: 'var(--green)' }} /></div>
                        </div>
                      ));
                    })()}
                </div>
              )}

              {/* AI Insights — full width below categories */}
              {s.insights && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <h3>AI Insights</h3>
                  <div className="psub">
                    {rep.insights.tips.length === 0
                      ? 'Not enough data for this period'
                      : rep.insights.totalSavePerMonth > 0
                        ? `${rep.insights.tips.length} observation${rep.insights.tips.length !== 1 ? 's' : ''} · ${fmt0(rep.insights.totalSavePerMonth)}/mo in potential savings identified`
                        : `${rep.insights.tips.length} observation${rep.insights.tips.length !== 1 ? 's' : ''} from your spending`}
                  </div>

                  {/* Stat pills */}
                  {(rep.insights.savingsRate > 0 || rep.insights.totalSavePerMonth > 0) && (
                    <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                      {rep.insights.savingsRate > 0 && (
                        <div className="ins-pill">
                          <div className="num">{rep.insights.savingsRate}%</div>
                          <div className="lbl">savings rate</div>
                        </div>
                      )}
                      {rep.insights.totalSavePerMonth > 0 && (
                        <div className="ins-pill">
                          <div className="num" style={{ color: 'var(--v500)' }}>{fmt0(rep.insights.totalSavePerMonth)}</div>
                          <div className="lbl">potential savings/mo</div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Highlights — personalized interesting facts derived from your data */}
                  {(() => {
                    const facts = buildFacts(rep, fmt, fmt0).slice(0, 6);
                    return facts.length ? (
                      <div style={{ marginBottom: 18 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10 }}>Highlights</div>
                        <div style={{ display: 'grid', gridTemplateColumns: facts.length >= 2 ? '1fr 1fr' : '1fr', gap: 10 }}>
                          {facts.map((f, i) => (
                            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--hairline)' }}>
                              <span style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 }}>{f.text}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null;
                  })()}

                  {/* Tips — 2-col grid when 3+ */}
                  {rep.insights.tips.length > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: rep.insights.tips.length >= 3 ? '1fr 1fr' : '1fr', gap: 12, marginBottom: 18 }}>
                      {rep.insights.tips.map((t, i) => (
                        <div key={i} className="ins-tip">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ fontSize: 13, fontWeight: 650, marginBottom: 4 }}>{t.title}</div>
                              {t.savePerMonth > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--v500)', flexShrink: 0, whiteSpace: 'nowrap' }}>{fmt0(t.savePerMonth)}/mo</div>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.55 }}>{t.text}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Disclaimer — bottom */}
                  <div style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.6, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6 }}>
                    Not financial advice. These observations are generated automatically from your transaction data for informational purposes only. Always consult a qualified financial advisor before making financial decisions.
                  </div>
                </div>
              )}

              {/* Top Spending */}
              {s.topSpending && rep.biggest.length > 0 && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <h3>Top Spending</h3>
                  <div className="psub">Merchants ranked by total spend — repeated visits are grouped into one row</div>
                  {(() => {
                    const top = rep.biggest.slice(0, rp.topN);
                    const max = Math.max(...top.map(b => Math.abs(b.amount)), 1);
                    return top.map((b, i) => {
                      const amt = Math.abs(b.amount);
                      const c = color(b.category);
                      return (
                        <div className="ts-row" key={i} style={{ animationDelay: `${i * 35}ms` }}>
                          <span className={'ts-rank' + (i < 3 ? ' top' : '')}>{i + 1}</span>
                          <div className="ts-main">
                            <div className="ts-head">
                              <span className="ts-name">{b.name}</span>
                              <span className="ts-amt">{fmt(amt)}</span>
                            </div>
                            <div className="ts-track"><div className="ts-fill" style={{ width: Math.max(4, (amt / max) * 100) + '%', background: c }} /></div>
                            <span className="ts-cat"><i style={{ display: 'inline-block', width: 7, height: 7, background: c, marginRight: 6, verticalAlign: 'middle' }} />{b.category}{b.count && b.count > 1 ? ` · ×${b.count}` : ''}</span>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}

              {/* Subscriptions — per-item cost with monthly + yearly totals */}
              {s.subscriptions && rep.subscriptions.count > 0 && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <h3>Subscriptions Detected</h3>
                  <div className="psub">{rep.subscriptions.count} recurring service{rep.subscriptions.count !== 1 ? 's' : ''} · {fmt0(rep.subscriptions.monthly)}/mo · {fmt0(rep.subscriptions.annual)}/yr</div>
                  {rep.subscriptions.items.map(it => (
                    <div className="lrow" key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ width: 9, height: 9, background: color(it.name), flexShrink: 0, display: 'inline-block' }} />
                      <span className="name" style={{ flex: 1, minWidth: 0 }}>{it.name}</span>
                      <span style={{ color: 'var(--faint)', fontSize: 11, width: 70, textAlign: 'right' }}>{it.cadence}</span>
                      <span className="val" style={{ width: 90, textAlign: 'right' }}>{fmt(it.monthly)}/mo</span>
                      <span style={{ color: 'var(--faint)', fontSize: 12, width: 90, textAlign: 'right' }}>{fmt0(it.annual)}/yr</span>
                    </div>
                  ))}
                  <div className="lrow" style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid var(--line)', marginTop: 4, fontWeight: 700 }}>
                    <span style={{ flex: 1 }}>Total</span>
                    <span className="val" style={{ width: 90, textAlign: 'right' }}>{fmt(rep.subscriptions.monthly)}/mo</span>
                    <span style={{ width: 90, textAlign: 'right' }}>{fmt0(rep.subscriptions.annual)}/yr</span>
                  </div>
                </div>
              )}

              {/* Investments — dynamically detected investment accounts + change in value */}
              {s.investments && rep.investments?.hasData && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <h3>Investments</h3>
                  <div className="psub">
                    Change in value this period{rep.investments.asOf ? ` · values as of ${rep.investments.asOf}` : ''}
                  </div>

                  <div style={{ display: 'flex', gap: 10, margin: '4px 0 16px', flexWrap: 'wrap' }}>
                    <div className="ins-pill">
                      <div className="num">{fmt0(rep.investments.totalValue)}</div>
                      <div className="lbl">total value</div>
                    </div>
                    {rep.investments.totalChange != null && (
                      <div className="ins-pill">
                        <div className="num" style={{ color: rep.investments.totalChange >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {rep.investments.totalChange >= 0 ? '+' : ''}{fmt0(rep.investments.totalChange)}
                        </div>
                        <div className="lbl">change this period</div>
                      </div>
                    )}
                  </div>

                  {rep.investments.accounts.map((a, i) => (
                    <div className="catrow" key={i}>
                      <div className="cat-top">
                        <span className="cat-name"><i style={{ background: color(a.name) }} />{a.name} <span style={{ color: 'var(--faint)', fontSize: 11 }}>••{a.mask}</span></span>
                        <span className="cat-amt">{fmt(a.value)}</span>
                      </div>
                      {a.tracking
                        ? <span className="cat-delta" style={{ color: 'var(--faint)' }}>tracking started{a.since ? ` ${a.since}` : ''} · change shows next period</span>
                        : <span className={'cat-delta ' + ((a.change || 0) >= 0 ? 'good' : 'bad')}>{(a.change || 0) >= 0 ? '▲' : '▼'} {fmt0(Math.abs(a.change || 0))}{a.changePct != null ? ` (${a.changePct >= 0 ? '+' : ''}${a.changePct}%)` : ''} this period</span>}
                    </div>
                  ))}

                  <div style={{ fontSize: 11, color: 'var(--faint)', lineHeight: 1.6, padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 6, marginTop: 14 }}>
                    Balances refresh 3 times a month (1st, 15th, last day), so values{rep.investments.asOf ? ` are as of ${rep.investments.asOf} and` : ''} may not reflect live market prices. Figures show change in account value, not investment return{rep.investments.contributions > 0 ? `; about ${fmt0(rep.investments.contributions)} in contributions went to savings or investments this period` : ''}.
                  </div>
                </div>
              )}

              {/* New merchants */}
              {rep.newMerchants.length > 0 && (
                <div className="panel" style={{ marginBottom: 24 }}>
                  <h3>New This Period</h3>
                  <div className="psub">Places you spent at for the first time vs the prior period</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {rep.newMerchants.map(n => (
                      <span key={n} className="newchip">{n}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Report footer */}
              <div style={{ textAlign: 'center', padding: '16px 0 4px', fontSize: 11, color: 'var(--faint)', borderTop: '1px solid var(--hairline)' }}>
                Generated by Covisor &middot; {new Date().toLocaleDateString()} &middot; For informational purposes only &middot; Not financial advice
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

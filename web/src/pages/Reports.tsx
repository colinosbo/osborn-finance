import { useEffect, useState } from 'react';
import { api, fmt, fmt0, color } from '../api';
import { generateReportPDF } from '../pdf';
import type { Toast } from '../App';
import EmptyState from '../EmptyState';

// SVG donut of expenses by category — shown in the report and captured into the PDF.
function Donut({ cats, total }: { cats: { name: string; total: number }[]; total: number }) {
  const top = cats.slice(0, 9);
  const rest = cats.slice(9).reduce((s, c) => s + c.total, 0);
  const data = rest > 0 ? [...top, { name: 'Other', total: rest }] : top;
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

interface Kpi { value: number; prev: number; delta: number; pct: number | null }
interface Cat { name: string; total: number; count: number; prev: number; delta: number; share: number }
interface Report {
  days: number; offset: number;
  period: { from: string; to: string; label: string; days: number; grain: string };
  kpis: { income: Kpi; spend: Kpi; net: Kpi; savingsRate: Kpi; count: number };
  categories: Cat[];
  merchants: { name: string; total: number; count: number }[];
  trend: { label: string; in: number; out: number; net: number }[];
  biggest: { date: string; name: string; merchant: string; amount: number; category: string }[];
  newMerchants: string[];
  subscriptions: { count: number; names: string[]; monthly: number };
  insights: { tips: { icon: string; title: string; text: string; savePerMonth: number; pinned?: boolean }[]; totalSavePerMonth: number; savingsRate: number };
}

const PRESETS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '6 months', days: 182 },
  { label: '1 year', days: 365 }
];

type Sections = { kpis: boolean; trend: boolean; categories: boolean; insights: boolean; merchants: boolean; notable: boolean };
interface RP { days: number; topN: number; sections: Sections }
const RKEY = 'of_report_prefs';
const DEFAULT_RP: RP = { days: 30, topN: 8, sections: { kpis: true, trend: true, categories: true, insights: true, merchants: true, notable: true } };
const loadRP = (): RP => { try { const s = JSON.parse(localStorage.getItem(RKEY) || '{}'); return { ...DEFAULT_RP, ...s, sections: { ...DEFAULT_RP.sections, ...(s.sections || {}) } }; } catch { return { ...DEFAULT_RP }; } };
const saveRP = (rp: RP) => localStorage.setItem(RKEY, JSON.stringify(rp));

function Delta({ k, goodUp, rate }: { k: Kpi; goodUp: boolean; rate?: boolean }) {
  if (!k.prev && !k.delta) return <span className="delta flat">— no prior data</span>;
  const up = k.delta >= 0, good = up === goodUp;
  const txt = rate ? `${k.delta > 0 ? '+' : ''}${k.delta} pts`
    : `${k.delta > 0 ? '+' : ''}${fmt0(k.delta)}${k.pct != null ? ` · ${k.pct > 0 ? '+' : ''}${k.pct}%` : ''}`;
  return <span className={'delta ' + (good ? 'good' : 'bad')}>{up ? '▲' : '▼'} {txt} <span className="delta-vs">vs prior</span></span>;
}

function Trend({ data }: { data: Report['trend'] }) {
  const max = Math.max(1, ...data.map(d => Math.max(d.in, d.out)));
  const n = Math.max(1, data.length), bw = Math.max(5, (520 / n - 8) / 2);
  return (
    <svg className="trendchart" viewBox="0 0 520 150" preserveAspectRatio="none" role="img" aria-label="Income vs spending trend">
      {data.map((d, i) => {
        const x = i * (520 / n) + 8, inH = (d.in / max) * 120, outH = (d.out / max) * 120;
        return (<g key={i}>
          <rect className="tb-in" x={x} y={130 - inH} width={bw} height={inH} />
          <rect className="tb-out" x={x + bw + 2} y={130 - outH} width={bw} height={outH} />
          <text className="tb-lab" x={x + bw} y={146} textAnchor="middle">{d.label}</text>
        </g>);
      })}
    </svg>
  );
}

function Check({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <label className="rc-check"><input type="checkbox" checked={on} onChange={onToggle} /> {label}</label>
  );
}

export default function Reports({ toast }: { toast: Toast }) {
  const [rp, setRp] = useState<RP>(loadRP());
  const [offset, setOffset] = useState(0);
  const [rep, setRep] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [customOpen, setCustomOpen] = useState(!PRESETS.some(p => p.days === loadRP().days));
  const [customDays, setCustomDays] = useState(String(loadRP().days));
  const [showCustomize, setShowCustomize] = useState(false);

  const update = (patch: Partial<RP>) => { const next = { ...rp, ...patch }; setRp(next); saveRP(next); };
  const setSection = (k: keyof Sections) => update({ sections: { ...rp.sections, [k]: !rp.sections[k] } });

  const fetchReport = () => {
    setLoading(true);
    api<Report>(`/api/reports?days=${rp.days}&offset=${offset}`).then(r => { setRep(r); setLoading(false); }).catch(() => setLoading(false));
  };
  useEffect(fetchReport, [rp.days, offset]); // auto-generate on range/period change

  const pickPreset = (days: number) => { setCustomOpen(false); setOffset(0); update({ days }); };
  const generateCustom = () => {
    const d = Math.max(1, Math.min(3650, parseInt(customDays, 10) || 30));
    setCustomDays(String(d)); setOffset(0);
    if (d === rp.days) fetchReport(); else update({ days: d });
    toast(`Report generated · last ${d} days`);
  };

  const isYear = rp.days >= 365;
  const s = rp.sections;

  const downloadCSV = () => {
    if (!rep) return;
    const lines = ['Section,Name,Amount,Count,Share %,Delta vs prior'];
    lines.push(`KPI,Income,${rep.kpis.income.value},,,${rep.kpis.income.delta}`);
    lines.push(`KPI,Spend,${rep.kpis.spend.value},,,${rep.kpis.spend.delta}`);
    lines.push(`KPI,Net,${rep.kpis.net.value},,,${rep.kpis.net.delta}`);
    rep.categories.forEach(c => lines.push(`Category,"${c.name}",${c.total},${c.count},${c.share},${c.delta}`));
    rep.merchants.forEach(m => lines.push(`Merchant,"${m.name}",${m.total},${m.count},,`));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `osborn-report-${rp.days}d.csv`; a.click();
    toast('CSV downloaded');
  };

  return (
    <>
      <div className="sec-head"><span className="sec-num">06</span><span className="sec-title">Reports</span></div>
      <div className="sec-sub">Pick a range, generate, and tailor what you see</div>

      {/* ---- control panel ---- */}
      <div className="panel rep-controls" style={{ marginBottom: 22 }}>
        <div className="rc-row">
          <span className="rc-lbl">Time range</span>
          <div className="seg">
            {PRESETS.map(p => (
              <button key={p.days} className={'seg-btn' + (!customOpen && rp.days === p.days ? ' active' : '')} onClick={() => pickPreset(p.days)}>{p.label}</button>
            ))}
            <button className={'seg-btn' + (customOpen ? ' active' : '')} onClick={() => setCustomOpen(true)}>Custom</button>
          </div>
        </div>
        {customOpen && (
          <div className="rc-row rc-custom">
            <span className="rc-lbl">Last</span>
            <input type="number" min={1} max={3650} value={customDays} onChange={e => setCustomDays(e.target.value)} style={{ width: 90 }}
              onKeyDown={e => { if (e.key === 'Enter') generateCustom(); }} />
            <span className="rc-lbl">days</span>
            <button className="btn primary" onClick={generateCustom}>Generate report</button>
          </div>
        )}
        <div className="rc-row rc-foot">
          <button className="rc-toggle" onClick={() => setShowCustomize(v => !v)}>⚙ Customize report {showCustomize ? '▴' : '▾'}</button>
        </div>
        {showCustomize && (
          <div className="rc-panel">
            <div className="rc-panel-grp">
              <div className="rc-panel-title">Sections</div>
              <div className="rc-checks">
                <Check label="Summary KPIs" on={s.kpis} onToggle={() => setSection('kpis')} />
                <Check label="Cash-flow trend" on={s.trend} onToggle={() => setSection('trend')} />
                <Check label="Categories" on={s.categories} onToggle={() => setSection('categories')} />
                <Check label="Insights" on={s.insights} onToggle={() => setSection('insights')} />
                <Check label="Top merchants" on={s.merchants} onToggle={() => setSection('merchants')} />
                <Check label="Notable" on={s.notable} onToggle={() => setSection('notable')} />
              </div>
            </div>
            <div className="rc-panel-grp">
              <div className="rc-panel-title">Detail</div>
              <label className="fld" style={{ marginBottom: 0 }}><span>Rows per list</span>
                <select value={rp.topN} onChange={e => update({ topN: +e.target.value })}>
                  {[5, 8, 10, 15, 25].map(n => <option key={n} value={n}>Top {n}</option>)}
                </select>
              </label>
            </div>
          </div>
        )}
      </div>

      {/* ---- period + actions ---- */}
      <div className="rep-stepper">
        <button className="iconbtn" onClick={() => setOffset(o => o + 1)}>◀ Previous</button>
        <div className="rep-period">{rep ? <>{rep.period.label}{offset > 0 ? ` (${offset} back)` : ''} <span className="rep-range">{rep.period.from} → {rep.period.to}</span></> : 'Generating…'}</div>
        <button className="iconbtn" onClick={() => setOffset(o => Math.max(0, o - 1))} disabled={offset === 0}>Next ▶</button>
      </div>
      <div className="rep-actions" style={{ marginBottom: 18 }}>
        <button className="btn" onClick={fetchReport}>↻ Regenerate</button>
        <button className="btn" onClick={downloadCSV} disabled={!rep}>↓ CSV</button>
        <button className="btn" onClick={() => { if (rep) { toast('Building PDF…'); generateReportPDF(rep, { sections: rp.sections, topN: rp.topN }).then(() => toast('PDF downloaded')).catch(() => toast('PDF failed to generate')); } }} disabled={!rep}>⎙ PDF</button>
        <button className="btn" onClick={() => toast('Emailed reports arrive in Phase 2')} disabled={!rep}>✉ Email me</button>
        <button className="btn" disabled title="Coming soon">✆ Text me</button>
      </div>

      {/* ---- body ---- */}
      {loading && !rep ? (
        <div className="panel"><div className="skeleton" style={{ width: '40%', marginBottom: 14 }} /><div className="skeleton" style={{ height: 90 }} /></div>
      ) : !rep || rep.kpis.count === 0 ? (
        <EmptyState icon="chart" eyebrow="Reports" title="No activity in this range" sub="Try a longer range or step to a previous period. If you haven't linked an account yet, connect one to start generating reports." cta={{ to: '/accounts', label: 'Connect a bank' }} />
      ) : (
        <div className={'rep-body' + (loading ? ' busy' : '')}>
          <div className="rep-doc-head">
            <div className="rdh-brand">Osborn <span className="grad">Finance</span></div>
            <div className="rdh-title">Spending Report</div>
            <div className="rdh-sub">{rep.period.label} · {rep.period.from} → {rep.period.to} · {rep.period.days} days</div>
          </div>
          {isYear && s.kpis && (
            <div className="panel rep-hero">
              <div className="hero-kicker">{rep.period.label} — in review</div>
              <div className="hero-stat">You spent {fmt0(rep.kpis.spend.value)}</div>
              <div className="hero-sub">across {rep.kpis.count.toLocaleString()} transactions · saved {fmt0(rep.kpis.net.value)} ({rep.kpis.savingsRate.value}% rate)</div>
            </div>
          )}

          {s.kpis && (
            <div className="cards" style={{ marginBottom: 28 }}>
              <div className="card"><div className="label">Income</div><div className="value green">{fmt0(rep.kpis.income.value)}</div><Delta k={rep.kpis.income} goodUp /></div>
              <div className="card"><div className="label">Spending</div><div className="value">{fmt0(rep.kpis.spend.value)}</div><Delta k={rep.kpis.spend} goodUp={false} /></div>
              <div className="card"><div className="label">Net</div><div className={'value ' + (rep.kpis.net.value < 0 ? 'red' : 'green')}>{fmt0(rep.kpis.net.value)}</div><Delta k={rep.kpis.net} goodUp /></div>
              <div className="card"><div className="label">Savings rate</div><div className="value">{rep.kpis.savingsRate.value}%</div><Delta k={rep.kpis.savingsRate} goodUp rate /></div>
            </div>
          )}

          {s.trend && (
            <div className="panel" style={{ marginBottom: 28 }}>
              <h3>Cash flow</h3><div className="psub">Income vs spending across the range</div>
              <Trend data={rep.trend} />
              <div className="trend-legend"><span className="lg in">Income</span><span className="lg out">Spending</span></div>
            </div>
          )}

          {(s.categories || s.insights) && (
            <div className="row2">
              {s.categories && (
                <div className="panel">
                  <h3>Spending by category</h3><div className="psub">Share of spend with change vs. prior period</div>
                  {rep.categories.length > 0 && <Donut cats={rep.categories} total={rep.kpis.spend.value} />}
                  {rep.categories.length ? rep.categories.slice(0, rp.topN).map(c => (
                    <div className="catrow" key={c.name}>
                      <div className="cat-top"><span className="cat-name"><i style={{ background: color(c.name) }} />{c.name}</span><span className="cat-amt">{fmt(c.total)} <span className="cat-share">{c.share}%</span></span></div>
                      <div className="catbar-track"><div className="catbar-fill" style={{ width: Math.min(100, c.share) + '%', background: color(c.name) }} /></div>
                      {!!c.delta && <span className={'cat-delta ' + (c.delta > 0 ? 'bad' : 'good')}>{c.delta > 0 ? '▲' : '▼'} {fmt0(Math.abs(c.delta))} vs prior</span>}
                    </div>
                  )) : <div className="empty">No spending categorized in this range.</div>}
                </div>
              )}
              {s.insights && (
                <div className="panel">
                  <h3>Insights</h3><div className="psub">{rep.insights.totalSavePerMonth > 0 ? `Up to ${fmt0(rep.insights.totalSavePerMonth)}/mo in opportunities` : 'Personalized observations'}</div>
                  {rep.insights.tips.map((t, i) => (
                    <div className="advrow" key={i}><div className="advicon">{t.icon}</div><div style={{ flex: 1 }}><div className="advtitle">{t.title}</div><div className="advtext">{t.text}</div></div>{t.savePerMonth > 0 && <div className="advsave">{fmt0(t.savePerMonth)}/mo</div>}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(s.merchants || s.notable) && (
            <div className="row2">
              {s.merchants && (
                <div className="panel">
                  <h3>Top merchants</h3><div className="psub">Where the money went</div>
                  {rep.merchants.slice(0, rp.topN).map(m => (<div className="lrow" key={m.name}><span className="name">{m.name}</span><span style={{ fontSize: 11, color: 'var(--faint)' }}>{m.count}×</span><span className="val">{fmt(m.total)}</span></div>))}
                  {!rep.merchants.length && <div className="empty">No merchants this range.</div>}
                </div>
              )}
              {s.notable && (
                <div className="panel">
                  <h3>Notable</h3><div className="psub">Biggest purchases, new merchants &amp; subscriptions</div>
                  {rep.biggest.map((b, i) => (<div className="lrow" key={i}><span className="name">{b.name}<span style={{ color: 'var(--faint)', fontWeight: 400 }}> · {b.category}</span></span><span className="val red">{fmt(b.amount)}</span></div>))}
                  <div className="notable-tags">
                    {rep.subscriptions.count > 0 && <span className="ntag">↻ {rep.subscriptions.count} subscriptions · {fmt0(rep.subscriptions.monthly)}/mo</span>}
                    {rep.newMerchants.slice(0, 6).map(m => <span className="ntag new" key={m}>＋ {m}</span>)}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

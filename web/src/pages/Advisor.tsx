import { useEffect, useState } from 'react';
import { api, fmt, fmt0, color, fmtDate } from '../api';
import { loadPrefs } from '../prefs';
import EmptyState from '../EmptyState';
import RangePicker, { DEFAULT_RANGE, rangeQS, type RangeOpt } from '../RangePicker';

interface Tip { icon: string; title: string; text: string; savePerMonth: number; savePerYear?: number }
interface Factor { label: string; status: 'good' | 'ok' | 'warn'; points: number; max: number; detail: string }
interface Bud { amount: number; pct: number; guide: number }
interface Trend { category: string; now: number; prev: number; deltaPct: number; deltaAbs: number; direction: 'up' | 'down' | 'new' }
interface Anom { date: string; name: string; merchant: string; amount: number; category: string; reason: string }
interface Adv {
  hasData: boolean;
  tips: Tip[]; totalSavePerMonth: number; totalSavePerYear: number; savingsRate: number;
  score: { value: number; grade: string; label: string; factors: Factor[] };
  budget: { income: number; needs: Bud; wants: Bud; savings: Bud; verdict: string };
  trends: Trend[]; anomalies: Anom[]; wins: { title: string; text: string }[];
  actionPlan: Tip[];
  period: { from: string | null; to: string | null; months: number; income: number; spend: number; net: number };
}

const GRADE_COLOR: Record<string, string> = { A: 'var(--green)', B: 'var(--green)', C: '#f08c00', D: '#f08c00', F: 'var(--red)' };
const STATUS_COLOR: Record<string, string> = { good: 'var(--green)', ok: '#f08c00', warn: 'var(--red)' };

function ScoreRing({ value, grade }: { value: number; grade: string }) {
  const R = 52, C = 2 * Math.PI * R, dash = (value / 100) * C;
  const col = GRADE_COLOR[grade] || 'var(--v600)';
  return (
    <div className="adv-ring">
      <svg width="130" height="130" viewBox="0 0 130 130">
        <circle cx="65" cy="65" r={R} fill="none" stroke="var(--hairline)" strokeWidth="11" />
        <circle cx="65" cy="65" r={R} fill="none" stroke={col} strokeWidth="11" strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`} transform="rotate(-90 65 65)" style={{ transition: 'stroke-dasharray .9s var(--ease)' }} />
      </svg>
      <div className="adv-ring-center">
        <span className="adv-ring-val">{value}</span>
        <span className="adv-ring-grade" style={{ color: col }}>{grade}</span>
      </div>
    </div>
  );
}

export default function Advisor() {
  const df = loadPrefs().dateFormat;
  const [a, setA] = useState<Adv | null>(null);
  const [range, setRange] = useState<RangeOpt>(DEFAULT_RANGE);
  const [err, setErr] = useState('');
  const [accounts, setAccounts] = useState<string[]>([]);
  const [acctFilter, setAcctFilter] = useState('');
  useEffect(() => { api<string[]>('/api/tx-accounts').then(setAccounts).catch(() => {}); }, []);
  useEffect(() => {
    setA(null);
    const qs = rangeQS(range) + (acctFilter ? `&accounts=${encodeURIComponent(acctFilter)}` : '');
    api<Adv>(`/api/advisor?${qs}`).then(setA).catch(e => setErr(e.message));
  }, [range, acctFilter]);

  return (
    <>
      <div className="sec-head"><span className="sec-num">04</span><span className="sec-title">✦ AI <span className="grad">Advisor</span></span></div>
      <div className="sec-sub">Your financial health, what changed, and the highest-impact moves, recalculated for the selected period</div>
      <div className="controls">
        <RangePicker value={range.value} onChange={setRange} />
        {accounts.length > 1 && (
          <select value={acctFilter} onChange={e => setAcctFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}
      </div>

      {err && <div className="empty">Error: {err}</div>}
      {!a && !err && <div className="panel"><div className="skeleton" style={{ width: '45%', marginBottom: 14 }} /><div className="skeleton" style={{ height: 90 }} /></div>}

      {a && !a.hasData && (
        <EmptyState
          icon="advisor"
          eyebrow="AI Advisor"
          title="Nothing to evaluate yet"
          sub="Your financial health score is built from your real transactions. Connect a bank or import a CSV, and once activity comes in you'll get a full evaluation here, no manual input needed."
          cta={{ to: '/accounts', label: 'Connect a bank' }}
        />
      )}

      {a && a.hasData && (
        <>
          {/* ===== Health score ===== */}
          <div className="panel adv-score">
            <div className="adv-score-main">
              <ScoreRing value={a.score.value} grade={a.score.grade} />
              <div>
                <div className="adv-score-kicker">Financial health score</div>
                <div className="adv-score-label">{a.score.label}</div>
                <div className="adv-score-sub">{a.period.months}-month basis · income {fmt0(a.period.income)} · net {a.period.net >= 0 ? '+' : ''}{fmt0(a.period.net)}</div>
              </div>
            </div>
            <div className="adv-factors">
              {a.score.factors.map(f => (
                <div className="adv-factor" key={f.label}>
                  <div className="adv-factor-top">
                    <span className="adv-factor-lbl">{f.label}</span>
                    <span className="adv-factor-pts" style={{ color: STATUS_COLOR[f.status] }}>{Math.round(f.points)}/{f.max}</span>
                  </div>
                  <div className="adv-factor-bar"><span style={{ width: `${(f.points / f.max) * 100}%`, background: STATUS_COLOR[f.status] }} /></div>
                  <div className="adv-factor-detail">{f.detail}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ===== 50/30/20 + What changed ===== */}
          <div className="row2">
            <div className="panel">
              <h3>Needs · Wants · Savings</h3><div className="psub">Your split vs the 50/30/20 guideline</div>
              {([['Needs', a.budget.needs, 'var(--v600)'], ['Wants', a.budget.wants, '#f08c00'], ['Savings', a.budget.savings, 'var(--green)']] as const).map(([lbl, b, c]) => (
                <div className="adv-bud" key={lbl}>
                  <div className="adv-bud-head"><span>{lbl}</span><span className="adv-bud-amt">{fmt0(b.amount)} · <b>{b.pct}%</b> <span className="adv-bud-guide">/ {b.guide}%</span></span></div>
                  <div className="adv-bud-bar">
                    <span style={{ width: `${Math.min(100, b.pct)}%`, background: c }} />
                    <i className="adv-bud-mark" style={{ left: `${Math.min(100, b.guide)}%` }} title={`Guideline ${b.guide}%`} />
                  </div>
                </div>
              ))}
              <div className="adv-verdict">{a.budget.verdict}</div>
            </div>

            <div className="panel">
              <h3>What changed</h3><div className="psub">Biggest moves vs the previous period</div>
              {a.trends.length === 0 && a.anomalies.length === 0 && <div className="empty">Not enough prior history to compare yet.</div>}
              {a.trends.map(t => (
                <div className="adv-trend" key={'t' + t.category}>
                  <span className="adv-trend-ico" style={{ color: t.direction === 'up' ? 'var(--red)' : t.direction === 'down' ? 'var(--green)' : 'var(--v600)' }}>{t.direction === 'up' ? '↑' : t.direction === 'down' ? '↓' : '✦'}</span>
                  <span className="adv-trend-cat"><i style={{ background: color(t.category) }} />{t.category}</span>
                  <span className="adv-trend-delta" style={{ color: t.direction === 'up' ? 'var(--red)' : 'var(--green)' }}>
                    {t.direction === 'new' ? 'new' : `${t.deltaPct > 0 ? '+' : ''}${t.deltaPct}%`}
                  </span>
                  <span className="adv-trend-amt">{fmt0(t.now)}</span>
                </div>
              ))}
              {a.anomalies.length > 0 && <div className="adv-anom-head">Unusual charges</div>}
              {a.anomalies.map((x, i) => (
                <div className="adv-anom" key={'a' + i}>
                  <span className="adv-anom-ico" style={{ background: color(x.category) }}>!</span>
                  <div className="adv-anom-meta"><b>{x.merchant || x.name}</b><span>{fmtDate(x.date, df)} · {x.reason}</span></div>
                  <span className="adv-anom-amt">{fmt(x.amount)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* ===== Wins ===== */}
          {a.wins.length > 0 && (
            <div className="panel adv-wins">
              <h3>What's going well</h3>
              <div className="adv-wins-grid">
                {a.wins.map((w, i) => (
                  <div className="adv-win" key={i}><span className="adv-win-ico">✓</span><div><b>{w.title}</b><span>{w.text}</span></div></div>
                ))}
              </div>
            </div>
          )}

          {/* ===== Action plan ===== */}
          <div className="panel" style={{ borderTop: '3px solid var(--v600)', marginTop: 24 }}>
            <div className="adv-plan-head">
              <div><h3>Your action plan</h3><div className="psub">Highest-impact moves first</div></div>
              {a.totalSavePerMonth > 1 && <div className="adv-plan-total"><span>Potential</span><b>{fmt0(a.totalSavePerMonth)}/mo</b><span>≈ {fmt0(a.totalSavePerYear)}/yr</span></div>}
            </div>
            {a.actionPlan.length === 0 && <div className="empty">No clear savings opportunities stand out this period. Your spending already looks well controlled.</div>}
            {a.actionPlan.map((t, i) => (
              <div className="adv-act" key={i}>
                <span className="adv-act-rank">{i + 1}</span>
                <div className="adv-act-body">
                  <div className="adv-act-title">{t.icon} {t.title}</div>
                  <div className="adv-act-text">{t.text}</div>
                </div>
                {t.savePerYear && t.savePerYear > 12 ? <div className="adv-act-save"><b>{fmt0(t.savePerYear)}</b><span>/yr</span></div> : <div className="adv-act-save muted">·</div>}
              </div>
            ))}
            <div className="adv-disclaimer">Generated automatically from your transaction patterns. Informational only, not professional financial advice.</div>
          </div>
        </>
      )}
    </>
  );
}


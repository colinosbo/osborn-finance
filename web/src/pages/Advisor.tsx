import { useEffect, useState } from 'react';
import { api, fmt0 } from '../api';

interface Adv { tips: { icon: string; title: string; text: string; savePerMonth: number }[]; totalSavePerMonth: number; savingsRate: number; }

export default function Advisor() {
  const [a, setA] = useState<Adv | null>(null);
  const [days, setDays] = useState(365);
  useEffect(() => { api<Adv>(`/api/advisor?days=${days}`).then(setA); }, [days]);
  return (
    <>
      <div className="sec-head"><span className="sec-num">04</span><span className="sec-title">✦ AI <span className="grad">Advisor</span></span></div>
      <div className="sec-sub">Personalized insights, recalculated for the selected period</div>
      <div className="controls">
        {[[30,'Last Month'],[91,'3 Months'],[182,'6 Months'],[365,'Last Year'],[0,'All Time']].map(([d,l]) =>
          <button key={d} className={'btn' + (days === d ? ' primary' : '')} onClick={() => setDays(d as number)}>{l}</button>)}
      </div>
      <div className="panel" style={{ borderTop: '3px solid var(--v600)' }}>
        {!a && <div className="empty">Loading…</div>}
        {a?.tips.map((t, i) => (
          <div className="advrow" key={i}>
            <div className="advicon">{t.icon}</div>
            <div style={{ flex: 1 }}><div className="advtitle">{t.title}</div><div className="advtext">{t.text}</div></div>
            {t.savePerMonth > 1 && <div className="advsave">≈ {fmt0(t.savePerMonth)}/mo back</div>}
          </div>
        ))}
        {a && a.totalSavePerMonth > 1 && (
          <div className="advrow">
            <div className="advicon">Σ</div>
            <div style={{ flex: 1 }}><div className="advtitle">Total opportunity</div><div className="advtext">Acting on the above frees roughly {fmt0(a.totalSavePerMonth)}/mo — about {fmt0(a.totalSavePerMonth * 12)} a year.</div></div>
            <div className="advsave">≈ {fmt0(a.totalSavePerMonth)}/mo</div>
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 14 }}>Generated automatically from transaction patterns. Informational only — not professional financial advice.</div>
      </div>
    </>
  );
}

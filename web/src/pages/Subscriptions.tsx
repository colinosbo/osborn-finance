import { useEffect, useState } from 'react';
import { api, fmt, fmt0, color, fmtDate } from '../api';
import { loadPrefs } from '../prefs';
import EmptyState from '../EmptyState';

interface PriceChange {
  previousAmount: number; currentAmount: number; deltaAmount: number;
  pct: number; direction: 'up' | 'down'; since: string; annualImpact: number;
}
interface Sub {
  merchant: string; category: string; amount: number; cadence: string; periodDays: number;
  monthlyCost: number; annualCost: number; lastCharged: string; nextCharge: string;
  count: number; active: boolean; confidence: number; priceChange?: PriceChange;
}
interface Resp {
  subscriptions: Sub[];
  totals: { activeCount: number; monthlyTotal: number; annualTotal: number };
  alerts: { increaseCount: number; monthlyImpact: number; annualImpact: number };
}

const initials = (s: string) => (s || '?').replace(/[^a-zA-Z0-9]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

function Row({ s, df }: { s: Sub; df: string }) {
  const pc = s.priceChange;
  return (
    <div className={'sub-row' + (s.active ? '' : ' lapsed')}>
      <span className="sub-ico" style={{ background: color(s.category) }}>{initials(s.merchant)}</span>
      <div className="sub-meta">
        <b>
          {s.merchant}
          {pc && pc.direction === 'up' && <span className="sub-hike">↑ {pc.pct}%</span>}
          {pc && pc.direction === 'down' && <span className="sub-drop">↓ {Math.abs(pc.pct)}%</span>}
        </b>
        <span>
          {s.cadence} · billed {s.count}× · last {fmtDate(s.lastCharged, df)}
          {pc && <span className="sub-pchg">{' · '}{fmt(pc.previousAmount)} → {fmt(pc.currentAmount)} since {fmtDate(pc.since, df)}</span>}
        </span>
      </div>
      <div className="sub-cadence">
        {s.active ? <><span className="sub-next-lbl">Next charge</span><span className="sub-next">{fmtDate(s.nextCharge, df)}</span></> : <span className="sub-lapsed-tag">Likely canceled</span>}
      </div>
      <div className="sub-amt">
        <b>{fmt(s.amount)}</b>
        <span>{fmt0(s.monthlyCost)}/mo · {fmt0(s.annualCost)}/yr</span>
      </div>
    </div>
  );
}

export default function Subscriptions() {
  const df = loadPrefs().dateFormat;
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { api<Resp>('/api/recurring').then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const active = data?.subscriptions.filter(s => s.active) || [];
  const lapsed = data?.subscriptions.filter(s => !s.active) || [];
  const soonest = active.map(s => s.nextCharge).sort()[0];
  const hikes = active.filter(s => s.priceChange && s.priceChange.direction === 'up')
    .sort((a, b) => (b.priceChange!.annualImpact) - (a.priceChange!.annualImpact));

  return (
    <>
      <div className="sec-head"><span className="sec-num">07</span><span className="sec-title">Subscriptions</span></div>
      <div className="sec-sub">Recurring charges detected from your spending — spot what's still active</div>

      {loading ? (
        <div className="panel"><div className="skeleton" style={{ width: '40%', marginBottom: 14 }} /><div className="skeleton" style={{ height: 70 }} /></div>
      ) : !data || data.subscriptions.length === 0 ? (
        <EmptyState
          icon="repeat"
          eyebrow="Subscriptions"
          title="No recurring charges detected yet"
          sub="We need a few months of history to spot subscriptions. Connect a bank and we'll surface every active recurring charge — with its cadence and yearly cost."
        />
      ) : (
        <>
          <div className="cards" style={{ marginBottom: 28 }}>
            <div className="card"><div className="label">Active subscriptions</div><div className="value">{data.totals.activeCount}</div><div className="detail">recurring charges</div></div>
            <div className="card"><div className="label">Monthly cost</div><div className="value">{fmt0(data.totals.monthlyTotal)}</div><div className="detail">across all active</div></div>
            <div className="card"><div className="label">Annual cost</div><div className="value">{fmt0(data.totals.annualTotal)}</div><div className="detail">projected per year</div></div>
            <div className="card"><div className="label">Next charge</div><div className="value" style={{ fontSize: 22 }}>{soonest ? fmtDate(soonest, df) : '—'}</div><div className="detail">soonest renewal</div></div>
          </div>

          {data.alerts.increaseCount > 0 && (
            <div className="alertbar" style={{ marginBottom: 24 }}>
              <div className="alertbar-head">
                <span className="alertbar-ico">↑</span>
                <div>
                  <b>{data.alerts.increaseCount} {data.alerts.increaseCount === 1 ? 'subscription has' : 'subscriptions have'} gone up in price</b>
                  <span>That's about {fmt0(data.alerts.monthlyImpact)}/mo more — roughly {fmt0(data.alerts.annualImpact)} extra a year if nothing changes.</span>
                </div>
              </div>
              <div className="alertbar-list">
                {hikes.map(s => (
                  <div className="alertbar-row" key={s.merchant}>
                    <span className="alertbar-name">{s.merchant}</span>
                    <span className="alertbar-chg">{fmt(s.priceChange!.previousAmount)} → {fmt(s.priceChange!.currentAmount)}</span>
                    <span className="alertbar-pct">+{s.priceChange!.pct}%</span>
                    <span className="alertbar-impact">+{fmt0(s.priceChange!.annualImpact)}/yr</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel" style={{ marginBottom: lapsed.length ? 24 : 0 }}>
            <h3>Active subscriptions</h3><div className="psub">Sorted by monthly cost</div>
            {active.length ? active.map(s => <Row key={s.merchant} s={s} df={df} />) : <div className="empty">No active subscriptions detected.</div>}
          </div>

          {lapsed.length > 0 && (
            <div className="panel">
              <h3>Lapsed / likely canceled</h3><div className="psub">Recurring before, but charges have stopped</div>
              {lapsed.map(s => <Row key={s.merchant} s={s} df={df} />)}
            </div>
          )}
        </>
      )}
    </>
  );
}

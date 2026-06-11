import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Toast } from '../App';

const FEATURES: Record<string, string[]> = {
  personal: ['1 bank connection, synced daily', 'Full dashboard & cash-flow views', 'AI Advisor with savings targets', 'Unlimited transaction history', 'CSV import included'],
  family: ['Up to 5 family members', 'Shared household dashboard', 'Private individual views', 'Budgets & spending alerts', 'Everything in Personal'],
  enterprise: ['Multi-client workspaces', 'SSO / SAML sign-in', 'API access & white-label reports', 'Priority support', 'Everything in Family']
};
const PRICE: Record<string, string> = { personal: '$3.99', family: '$10.99', enterprise: '$24.99' };
const PER: Record<string, string> = { personal: '/mo', family: '/mo', enterprise: '/mo per seat' };

export default function Plans({ toast }: { toast: Toast }) {
  const [plans, setPlans] = useState<{ id: string; label: string }[]>([]);
  const [current, setCurrent] = useState('');
  useEffect(() => {
    api<{ id: string; label: string }[]>('/api/plans').then(setPlans);
    api<{ plan: string }>('/api/me').then(m => setCurrent(m.plan));
  }, []);
  const buy = async (plan: string) => {
    const r = await api<{ url: string; mock: boolean }>('/api/billing/checkout', { method: 'POST', body: { plan } });
    if (r.mock) { toast(`${plan} plan activated (mock checkout — Stripe goes live with keys)`); setCurrent(plan); }
    else window.location.href = r.url;
  };
  return (
    <>
      <div className="sec-head"><span className="sec-num">$</span><span className="sec-title">Simple <span className="grad">Pricing</span></span></div>
      <div className="sec-sub">Every plan starts with a 14-day free trial · cancel anytime in two clicks</div>
      <div className="pricegrid">
        {plans.map(p => (
          <div key={p.id} className={'pcard' + (p.id === 'family' ? ' pop' : '')}>
            {p.id === 'family' && <div className="pbadge">Most popular</div>}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>{p.label}</div>
            <div className="pprice"><span className="grad">{PRICE[p.id]}</span><span className="pper"> {PER[p.id]}</span></div>
            <ul className="pfeat">{FEATURES[p.id].map(f => <li key={f}>{f}</li>)}</ul>
            {current === p.id
              ? <button className="btn" disabled>Current plan ✓</button>
              : <button className={'btn' + (p.id === 'family' ? ' primary' : '')} onClick={() => buy(p.id)}>Start {p.label}</button>}
          </div>
        ))}
      </div>
    </>
  );
}

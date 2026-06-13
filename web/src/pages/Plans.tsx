import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, planLabel } from '../api';
import { Icon, type IconName } from '../icons';
import type { Toast } from '../App';

const FEATURES: Record<string, string[]> = {
  personal: ['1 linked bank account', 'Full dashboard, ledger & reports', 'AI Advisor with savings tips', 'Subscription tracker', 'CSV import & data export'],
  family: ['Up to 5 linked banks', 'All accounts grouped together', 'Weekly to yearly report PDFs', 'Subscription tracking across accounts', 'Everything in Personal'],
  enterprise: ['Unlimited linked banks', 'Full data export & audit history', 'Priority email support', 'Early access to new features', 'Everything in Personal+']
};
const PRICE: Record<string, string> = { personal: '$4.99', family: '$9.99', enterprise: '$24.99' };
const PER: Record<string, string> = { personal: '/mo', family: '/mo', enterprise: '/mo' };
const META: Record<string, { icon: IconName; tagline: string; bestFor: string }> = {
  personal: { icon: 'profile', tagline: 'Get your money in order', bestFor: 'One bank, the full toolkit' },
  family: { icon: 'bank', tagline: 'Every account in one place', bestFor: 'Up to 5 linked banks' },
  enterprise: { icon: 'shield', tagline: 'For power users and pros', bestFor: 'Unlimited banks, priority support' }
};

// feature comparison across tiers
const CMP_COLS = ['Personal', 'Personal+', 'Enterprise'];
const CMP: { label: string; vals: (string | boolean)[] }[] = [
  { label: 'Automatic bank connections', vals: ['1', 'Up to 5', 'Unlimited'] },
  { label: 'CSV import & data export', vals: [true, true, true] },
  { label: 'Dashboard & ledger', vals: [true, true, true] },
  { label: 'Auto-categorization', vals: [true, true, true] },
  { label: 'Reports & PDF export', vals: [true, true, true] },
  { label: 'AI savings advisor', vals: [true, true, true] },
  { label: 'Subscription tracker', vals: [true, true, true] },
  { label: 'Audit history', vals: [false, false, true] },
  { label: 'Priority support', vals: [false, false, true] },
  { label: 'Early access to new features', vals: [false, false, true] }
];

const FAQ: { q: string; a: string }[] = [
  { q: 'Is there a free trial?', a: 'Yes. Every paid plan starts with a 7-day free trial, and you are not charged until it ends.' },
  { q: 'Can I cancel anytime?', a: 'Yes, in two clicks from billing. You keep access until the end of your current period.' },
  { q: 'Is my financial data safe?', a: 'Bank connections run through Plaid and your data is encrypted. We never see or store your bank login.' },
  { q: 'Can I switch plans later?', a: 'Anytime. Upgrades apply right away, and downgrades take effect on your next billing cycle.' },
  { q: 'What happens to my data if I cancel?', a: 'You can export all of your data to CSV at any time, including before you cancel.' }
];

const Check = () => (
  <svg className="cmp-check" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="5 12 10 17 19 7" /></svg>
);

const CONFETTI_COLORS = ['#8b5cf6', '#a78bfa', '#3ad07f', '#f76707', '#15aabf', '#f08c00', '#e8b500'];
const CONFETTI = Array.from({ length: 44 }, (_, i) => ({
  left: Math.round(Math.random() * 100),
  delay: +(Math.random() * 0.5).toFixed(2),
  dur: +(1.6 + Math.random() * 1.6).toFixed(2),
  color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  rot: Math.round(Math.random() * 360),
  size: 6 + Math.round(Math.random() * 6)
}));

function Celebrate({ plan, onClose }: { plan: string; onClose: () => void }) {
  return (
    <div className="celebrate" role="dialog" aria-label="Subscription confirmed" onClick={onClose}>
      <div className="confetti">
        {CONFETTI.map((c, i) => (
          <span key={i} style={{ left: c.left + '%', background: c.color, width: c.size, height: c.size * 1.6, animationDelay: c.delay + 's', animationDuration: c.dur + 's', transform: `rotate(${c.rot}deg)` }} />
        ))}
      </div>
      <div className="celebrate-card" onClick={e => e.stopPropagation()}>
        <div className="check-ring">
          <svg viewBox="0 0 52 52" width="68" height="68"><path className="check-path" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" d="M14 27 l8 8 l16 -18" /></svg>
        </div>
        <div className="celebrate-kicker">Payment successful</div>
        <h2 className="celebrate-title">You're on <span className="grad">{planLabel(plan)}</span></h2>
        <p className="celebrate-sub">Your 7-day free trial has started. Explore every feature, cancel anytime.</p>
        <button className="btn primary" onClick={onClose}>Let's go →</button>
      </div>
    </div>
  );
}

export default function Plans({ toast }: { toast: Toast }) {
  const [params, setParams] = useSearchParams();
  const [plans, setPlans] = useState<{ id: string; label: string }[]>([]);
  const [current, setCurrent] = useState('');
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    api<{ id: string; label: string }[]>('/api/plans').then(setPlans);
    api<{ plan: string }>('/api/me').then(m => setCurrent(m.plan));
  }, []);

  // returning from Stripe Checkout → celebrate + poll until the webhook updates the plan
  useEffect(() => {
    if (params.get('billing') !== 'success') return;
    setCelebrate(true);
    let tries = 0;
    const poll = setInterval(() => {
      tries++;
      api<{ plan: string }>('/api/me').then(m => setCurrent(m.plan)).catch(() => {});
      if (tries >= 6) clearInterval(poll);
    }, 1200);
    return () => clearInterval(poll);
  }, [params]);

  const closeCelebrate = () => { setCelebrate(false); setParams({}, { replace: true }); };

  const buy = async (plan: string) => {
    try {
      const r = await api<{ url: string; mock: boolean }>('/api/billing/checkout', { method: 'POST', body: { plan } });
      if (r.mock) { setCurrent(plan); setCelebrate(true); }
      else window.location.href = r.url;
    } catch (e) { toast('Could not start checkout: ' + (e as Error).message); }
  };

  return (
    <>
      {celebrate && <Celebrate plan={current && current !== 'free' ? current : 'your new plan'} onClose={closeCelebrate} />}

      <div className="plans-hero">
        <div className="land-eyebrow">Pricing</div>
        <h1 className="plans-title">Pick the plan that <span className="grad">fits your money</span></h1>
        <p className="plans-sub">Every paid plan starts with a 7-day free trial. No charge until it ends, cancel anytime in two clicks.</p>
      </div>

      <div className="pricegrid">
        {plans.map(p => {
          const m = META[p.id];
          const popular = p.id === 'family';
          return (
            <div key={p.id} className={'pcard' + (popular ? ' pop' : '')}>
              {popular && <div className="pbadge">Most popular</div>}
              <div className="pcard-top">
                {m && <span className="pcard-ico"><Icon name={m.icon} size={18} /></span>}
                <div>
                  <div className="pcard-name">{p.label}</div>
                  {m && <div className="pcard-tag">{m.tagline}</div>}
                </div>
              </div>
              <div className="pprice"><span className="grad">{PRICE[p.id]}</span><span className="pper"> {PER[p.id]}</span></div>
              {m && <div className="pcard-best">{m.bestFor}</div>}
              <ul className="pfeat">{FEATURES[p.id].map(f => <li key={f}>{f}</li>)}</ul>
              {current === p.id
                ? <button className="btn pcard-cta" disabled>Current plan ✓</button>
                : <button className={'btn pcard-cta' + (popular ? ' primary' : '')} onClick={() => buy(p.id)}>Start {p.label}</button>}
            </div>
          );
        })}
      </div>

      {/* Comparison */}
      <section className="cmp-wrap">
        <div className="cmp-head">
          <div className="land-eyebrow">Compare plans</div>
          <h2 className="land-h2">Everything that is included</h2>
        </div>
        <div className="cmp-scroll">
          <table className="cmp-table">
            <thead>
              <tr>
                <th></th>
                {CMP_COLS.map((c, i) => <th key={c} className={i === 1 ? 'cmp-pop' : ''}>{c}{i === 1 && <span className="cmp-poptag">Popular</span>}</th>)}
              </tr>
            </thead>
            <tbody>
              {CMP.map(row => (
                <tr key={row.label}>
                  <td className="cmp-label">{row.label}</td>
                  {row.vals.map((v, i) => (
                    <td key={i} className={'cmp-cell' + (i === 1 ? ' cmp-pop' : '')}>
                      {v === true ? <span className="cmp-yes"><Check /></span>
                        : v === false ? <span className="cmp-no" aria-label="Not included" />
                        : <span className="cmp-val">{v}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* FAQ */}
      <section className="faq-wrap">
        <div className="cmp-head">
          <div className="land-eyebrow">Questions</div>
          <h2 className="land-h2">Good to know before you start</h2>
        </div>
        <div className="faq-list">
          {FAQ.map(f => (
            <details className="faq-item" key={f.q}>
              <summary className="faq-q">{f.q}<span className="faq-chev">+</span></summary>
              <div className="faq-a">{f.a}</div>
            </details>
          ))}
        </div>
      </section>

      {/* Trust strip */}
      <div className="plans-trust">
        <span><Icon name="lock" size={15} /> Bank-level encryption</span>
        <span className="land-dot">·</span>
        <span><Icon name="shield" size={15} /> Secured by Plaid and Stripe</span>
        <span className="land-dot">·</span>
        <span><Icon name="repeat" size={15} /> Cancel anytime</span>
      </div>
    </>
  );
}

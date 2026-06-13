import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './icons';

const BENEFITS: { icon: IconName; title: string; text: string }[] = [
  { icon: 'ledger', title: 'Organized automatically', text: 'Every transaction sorted and grouped by merchant. No spreadsheets.' },
  { icon: 'chart', title: 'Reports on autopilot', text: 'Fresh summaries generated every month, ready to export as PDFs.' },
  { icon: 'repeat', title: 'Never miss a renewal', text: 'Active subscriptions caught, with their true yearly cost.' },
  { icon: 'spark', title: 'AI savings insights', text: 'See where you overspend and what you could save each month.' }
];

const STEPS: { n: string; title: string; text: string }[] = [
  { n: '1', title: 'Choose your plan', text: 'Pick the plan that fits you and start a 7-day free trial. This unlocks the app so you can connect accounts and see your money.' },
  { n: '2', title: 'Connect your bank', text: 'Link your accounts securely through Plaid in seconds. Your login is never seen or stored by us.' },
  { n: '3', title: 'Unlock everything', text: 'Dashboards, reports, subscription tracking, and savings insights, all kept up to date for you.' }
];

export default function DashboardLanding() {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>('.reveal'));
    const reduce = document.documentElement.getAttribute('data-reduce-motion') === 'on'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      || !('IntersectionObserver' in window);
    if (reduce) { items.forEach(i => i.classList.add('in')); return; }
    el.classList.add('reveal-on');
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
    items.forEach(i => io.observe(i));
    return () => io.disconnect();
  }, []);
  return (
    <div className="land" ref={root}>
      {/* Hero */}
      <section className="land-hero">
        <div className="land-hero-copy">
          <div className="land-eyebrow">Personal finance, automated</div>
          <h1 className="land-title">See every dollar.<br /><span className="grad">Across every account.</span></h1>
          <p className="land-sub">Osborn Finance links your banks, auto-categorizes every transaction, and turns the mess into clear dashboards, reports, and subscription tracking, so you always know where your money goes.</p>
          <div className="land-cta">
            <Link to="/plans" className="btn primary">View plans</Link>
          </div>
          <div className="land-trust">
            <span><Icon name="repeat" size={14} /> Starts with a 7-day free trial</span>
            <span className="land-dot">·</span>
            <span>Bank-level encryption</span>
            <span className="land-dot">·</span>
            <span>Cancel anytime</span>
          </div>
        </div>

        {/* Product preview, illustrative sample */}
        <div className="land-preview" aria-hidden>
          <div className="land-preview-tag">Sample dashboard</div>
          <div className="lp-cards">
            <div className="lp-card"><span className="lp-label">Income</span><span className="lp-val green">$6,480</span></div>
            <div className="lp-card"><span className="lp-label">Spending</span><span className="lp-val">$4,120</span></div>
            <div className="lp-card"><span className="lp-label">Net</span><span className="lp-val green">+$2,360</span></div>
          </div>
          <div className="lp-chart">
            {[42, 58, 36, 70, 50, 64, 46, 78].map((h, i) => (
              <div className="lp-bar-col" key={i}>
                <div className="lp-bar in" style={{ height: `${h}%` }} />
                <div className="lp-bar out" style={{ height: `${Math.max(14, h - 22)}%` }} />
              </div>
            ))}
          </div>
          <div className="lp-rows">
            {[['Groceries', 38], ['Dining', 27], ['Transport', 18], ['Subscriptions', 11]].map(([n, w]) => (
              <div className="lp-row" key={n as string}>
                <span className="lp-row-name">{n}</span>
                <span className="lp-row-bar"><span style={{ width: `${w}%` }} /></span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="land-benefits reveal">
        {BENEFITS.map(b => (
          <div className="land-benefit" key={b.title}>
            <div className="land-benefit-head">
              <span className="land-benefit-ico"><Icon name={b.icon} size={15} /></span>
              <div className="land-benefit-title">{b.title}</div>
            </div>
            <div className="land-benefit-text">{b.text}</div>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="land-how reveal">
        <div className="land-how-head">
          <div className="land-eyebrow">How it works</div>
          <h2 className="land-h2">Set up once. We keep it current.</h2>
        </div>
        <div className="land-steps">
          {STEPS.map(s => (
            <div className="land-step" key={s.n}>
              <span className="land-step-n">{s.n}</span>
              <div className="land-step-title">{s.title}</div>
              <div className="land-step-text">{s.text}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Security / trust */}
      <section className="land-security reveal">
        <div className="land-sec-head">
          <span className="land-sec-badge"><Icon name="shield" size={24} /></span>
          <div>
            <div className="land-eyebrow">Built security first</div>
            <h2 className="land-h2">Security comes first, always</h2>
          </div>
        </div>
        <p className="land-sec-lead">We are security centric by design. The safest data is the data we never hold, so we keep your most sensitive details out of our hands entirely and encrypt everything else, top to bottom. Here is how, and why it matters.</p>
        <div className="land-sec-grid">
          <div className="land-sec-item">
            <span className="land-sec-item-ico"><Icon name="bank" size={16} /></span>
            <div className="land-sec-item-title">We never see your login</div>
            <div className="land-sec-item-text">Bank connections run through Plaid. Your credentials go straight to your bank and never pass through us, so there is nothing for us to leak.</div>
          </div>
          <div className="land-sec-item">
            <span className="land-sec-item-ico"><Icon name="lock" size={16} /></span>
            <div className="land-sec-item-title">Encrypted end to end</div>
            <div className="land-sec-item-text">Your data is encrypted in transit and at rest, with encryption keys that we rotate on a schedule to limit exposure.</div>
          </div>
          <div className="land-sec-item">
            <span className="land-sec-item-ico"><Icon name="cloud" size={16} /></span>
            <div className="land-sec-item-title">Built on trusted cloud</div>
            <div className="land-sec-item-text">We run on Microsoft Azure, the same hardened cloud infrastructure that secures banks and large enterprises.</div>
          </div>
          <div className="land-sec-item">
            <span className="land-sec-item-ico"><Icon name="card" size={16} /></span>
            <div className="land-sec-item-title">Your card stays private</div>
            <div className="land-sec-item-text">Payments are processed by Stripe. Your card number never touches our servers, only your bank and Stripe see it.</div>
          </div>
        </div>
      </section>

      <footer className="land-foot">Osborn Finance · Bank-level security · Built on Microsoft Azure · Your data, always yours</footer>
    </div>
  );
}

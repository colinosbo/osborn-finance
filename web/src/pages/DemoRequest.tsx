import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Toast } from '../App';

type Field = 'firstName' | 'lastName' | 'email' | 'phone' | 'company' | 'comments';

const POINTS: { title: string; text: string }[] = [
  { title: 'A personalized walkthrough', text: 'We tailor it to how you manage money — not a canned product tour.' },
  { title: 'About 30 minutes', text: 'No prep needed, and we work around your schedule.' },
  { title: 'Ask us anything', text: 'Security, pricing, or moving over from spreadsheets and bank apps.' }
];

export default function DemoRequest({ toast }: { toast: Toast }) {
  const [f, setF] = useState<Record<Field, string>>({ firstName: '', lastName: '', email: '', phone: '', company: '', comments: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!f.firstName.trim() || !f.lastName.trim()) { setErr('Please enter your first and last name.'); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) { setErr('Please enter a valid email address.'); return; }
    setSending(true);
    try {
      await api('/api/demo-request', { method: 'POST', body: f });
      setDone(true);
      toast('Demo request sent');
    } catch (e2) { setErr((e2 as Error).message || 'Something went wrong. Please try again.'); }
    finally { setSending(false); }
  };

  if (done) return (
    <div className="demo-page">
      <div className="panel demo-done">
        <span className="demo-done-badge">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
        </span>
        <h2>Thanks, {f.firstName}!</h2>
        <p>Your request is in. Someone from the Covisor team will reach out to {f.email} shortly to schedule your walkthrough.</p>
        <Link to="/" className="btn primary" style={{ textDecoration: 'none' }}>Back to dashboard</Link>
      </div>
    </div>
  );

  return (
    <div className="demo-page">
      <div className="demo-grid">
        {/* Left: value / what to expect */}
        <div className="demo-copy">
          <div className="land-eyebrow">Book a demo</div>
          <h1 className="demo-title">See Covisor <span className="grad">in action</span></h1>
          <p className="demo-lead">In a quick walkthrough we'll show you how Covisor links your accounts, auto-categorizes spending, and turns the mess into clear reports — then answer whatever's on your mind.</p>
          <ul className="demo-points">
            {POINTS.map(p => (
              <li className="demo-point" key={p.title}>
                <b>{p.title}</b><span>{p.text}</span>
              </li>
            ))}
          </ul>
          <div className="demo-note">Usually scheduled within one business day</div>
        </div>

        {/* Right: form */}
        <div className="panel demo-form">
          <h3>Request your demo</h3>
          <div className="psub">Tell us a bit about you and we'll be in touch to set up a time.</div>
          <form onSubmit={submit}>
            <div className="demo-row2">
              <label className="fld"><span>First name *</span><input value={f.firstName} onChange={set('firstName')} placeholder="Jane" autoComplete="given-name" /></label>
              <label className="fld"><span>Last name *</span><input value={f.lastName} onChange={set('lastName')} placeholder="Doe" autoComplete="family-name" /></label>
            </div>
            <label className="fld"><span>Email *</span><input type="email" value={f.email} onChange={set('email')} placeholder="jane@company.com" autoComplete="email" /></label>
            <div className="demo-row2">
              <label className="fld"><span>Phone (optional)</span><input value={f.phone} onChange={set('phone')} placeholder="(555) 123-4567" autoComplete="tel" /></label>
              <label className="fld"><span>Company (optional)</span><input value={f.company} onChange={set('company')} placeholder="Acme Inc." autoComplete="organization" /></label>
            </div>
            <label className="fld"><span>Additional comments (optional)</span>
              <textarea value={f.comments} onChange={set('comments')} rows={4} placeholder="Anything else you'd like us to know?" />
            </label>
            {err && <div style={{ color: 'var(--red)', fontSize: 13, margin: '4px 0 12px' }}>{err}</div>}
            <div className="controls" style={{ marginBottom: 0, marginTop: 6 }}>
              <button type="submit" className="btn primary" disabled={sending}>{sending ? 'Sending…' : 'Request demo'}</button>
              <Link to="/" className="btn ghost" style={{ textDecoration: 'none' }}>Cancel</Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

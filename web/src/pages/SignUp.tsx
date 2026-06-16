import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { signIn, validEmail } from '../auth';

type Field = 'firstName' | 'lastName' | 'email' | 'pw';

export default function SignUp() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';
  const [f, setF] = useState<Record<Field, string>>({ firstName: '', lastName: '', email: '', pw: '' });
  const [err, setErr] = useState('');
  const set = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!f.firstName.trim() || !f.lastName.trim()) { setErr('Please enter your first and last name.'); return; }
    if (!validEmail(f.email)) { setErr('Please enter a valid email address.'); return; }
    if (f.pw.length < 6) { setErr('Password must be at least 6 characters.'); return; }
    signIn(f.email, `${f.firstName} ${f.lastName}`.trim());
    nav(next, { replace: true });
  };

  return (
    <div style={{ maxWidth: 460, margin: '5vh auto 0' }}>
      <div className="sec-head" style={{ justifyContent: 'center' }}>
        <span className="sec-title">Create your <span className="grad">account</span></span>
      </div>
      <div className="sec-sub" style={{ textAlign: 'center' }}>It only takes a moment to get started with Covisor.</div>
      <div className="panel">
        <form onSubmit={submit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <label className="fld"><span>First name</span><input value={f.firstName} onChange={set('firstName')} placeholder="Jane" autoComplete="given-name" autoFocus /></label>
            <label className="fld"><span>Last name</span><input value={f.lastName} onChange={set('lastName')} placeholder="Doe" autoComplete="family-name" /></label>
          </div>
          <label className="fld"><span>Email</span><input type="email" value={f.email} onChange={set('email')} placeholder="you@email.com" autoComplete="email" /></label>
          <label className="fld"><span>Password</span><input type="password" value={f.pw} onChange={set('pw')} placeholder="At least 6 characters" autoComplete="new-password" /></label>
          {err && <div style={{ color: 'var(--red)', fontSize: 13, margin: '2px 0 10px' }}>{err}</div>}
          <button type="submit" className="btn primary" style={{ width: '100%', marginTop: 4 }}>Create account</button>
        </form>
        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--faint)' }}>
          Already have an account? <Link to={`/signin?next=${encodeURIComponent(next)}`} style={{ color: 'var(--v500)' }}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}

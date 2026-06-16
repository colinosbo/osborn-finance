import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { signIn, validEmail } from '../auth';

export default function SignIn() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!validEmail(email)) { setErr('Please enter a valid email address.'); return; }
    if (!pw) { setErr('Please enter your password.'); return; }
    signIn(email);
    nav(next, { replace: true });
  };

  // TEMPORARY: one-click bypass for testing while there's no backend auth.
  // Remove this (and the button below) once Entra sign-in is wired up.
  const devBypass = () => {
    signIn('tester@covisor.com', 'Test User');
    nav(next, { replace: true });
  };

  return (
    <div style={{ maxWidth: 420, margin: '5vh auto 0' }}>
      <div className="sec-head" style={{ justifyContent: 'center' }}>
        <span className="sec-title">Sign in to <span className="grad">Covisor</span></span>
      </div>
      <div className="sec-sub" style={{ textAlign: 'center' }}>Welcome back. Sign in to continue.</div>
      <div className="panel">
        <form onSubmit={submit}>
          <label className="fld"><span>Email</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" autoComplete="email" autoFocus />
          </label>
          <label className="fld"><span>Password</span>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
          </label>
          {err && <div style={{ color: 'var(--red)', fontSize: 13, margin: '2px 0 10px' }}>{err}</div>}
          <button type="submit" className="btn primary" style={{ width: '100%', marginTop: 4 }}>Sign in</button>
        </form>

        {/* TEMPORARY testing-only bypass — remove once real auth is live */}
        <div className="dev-bypass">
          <button type="button" className="btn" style={{ width: '100%' }} onClick={devBypass}>⚡ Skip sign-in (testing)</button>
          <div className="dev-bypass-note">Temporary — logs you in instantly as a test user</div>
        </div>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--faint)' }}>
          New to Covisor? <Link to={`/signup?next=${encodeURIComponent(next)}`} style={{ color: 'var(--v500)' }}>Create an account</Link>
        </div>
      </div>
    </div>
  );
}

import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth0 } from '@auth0/auth0-react';

export default function SignUp() {
  const { loginWithRedirect, isAuthenticated, isLoading } = useAuth0();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get('next') || '/';

  useEffect(() => {
    if (isLoading) return;
    if (isAuthenticated) { nav(next, { replace: true }); return; }
    loginWithRedirect({ authorizationParams: { screen_hint: 'signup' }, appState: { returnTo: next } });
  }, [isLoading, isAuthenticated]);

  return (
    <div style={{ maxWidth: 420, margin: '5vh auto 0', textAlign: 'center', color: 'var(--faint)', padding: 32, fontSize: 15 }}>
      Redirecting to create account…
    </div>
  );
}

// Auth module — powered by Auth0.
// Import useAuth0 directly from @auth0/auth0-react for login/logout actions.
import { useAuth0 } from '@auth0/auth0-react';

export const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

// React hook: re-renders when sign-in state changes.
// Drop-in replacement for the old localStorage-based hook.
export function useAuth(): { signedIn: boolean; name: string; email: string } {
  const { isAuthenticated, user } = useAuth0();
  return {
    signedIn: isAuthenticated,
    name: user?.name || user?.nickname || '',
    email: user?.email || ''
  };
}

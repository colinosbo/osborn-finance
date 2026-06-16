// Lightweight client-side auth stub. Real auth (Entra/JWT) comes later; for now we
// just track a "signed in" flag so we can gate Plans / Demo / bank linking. Signing in
// also sets the dev identity email. State changes emit an event so the nav can react.
import { useSyncExternalStore } from 'react';
import { setEmail } from './api';

const AUTH_KEY = 'of_auth';
const NAME_KEY = 'of_auth_name';
const EMAIL_KEY = 'of_auth_email';
const EVT = 'of-auth-change';

// Notify in-tab subscribers. (The native 'storage' event only fires in OTHER tabs,
// so we dispatch our own event for the current tab.)
function emit(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVT));
}

export function isSignedIn(): boolean {
  return localStorage.getItem(AUTH_KEY) === '1';
}
export function authName(): string {
  return localStorage.getItem(NAME_KEY) || '';
}
export function authEmail(): string {
  return localStorage.getItem(EMAIL_KEY) || '';
}
export function signIn(email: string, name?: string): void {
  localStorage.setItem(AUTH_KEY, '1');
  if (name) localStorage.setItem(NAME_KEY, name);
  if (email) { localStorage.setItem(EMAIL_KEY, email.trim()); setEmail(email.trim()); }
  emit();
}
export function signOut(): void {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(NAME_KEY);
  localStorage.removeItem(EMAIL_KEY);
  emit();
}
export const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());
// (stub auth — replace with Entra/JWT when backend is deployed)

// Subscribe to auth changes (this tab via custom event, other tabs via storage).
export function subscribeAuth(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  window.addEventListener('storage', cb);
  return () => {
    window.removeEventListener(EVT, cb);
    window.removeEventListener('storage', cb);
  };
}

// React hook: re-renders the component whenever sign-in state changes.
// The external store snapshot is a plain string so React can compare it cheaply.
export function useAuth(): { signedIn: boolean; name: string; email: string } {
  const snap = useSyncExternalStore(
    subscribeAuth,
    () => `${isSignedIn() ? '1' : '0'}|${authName()}|${authEmail()}`,
    () => '0||'
  );
  const [s, name, email] = snap.split('|');
  return { signedIn: s === '1', name, email };
}

// API client. Production auth: Auth0 Bearer JWT. Dev fallback: x-user-email header.
const API_BASE = import.meta.env.VITE_API_URL || '';

// Wired up by App once Auth0 is initialised. Returns the access token or null.
let _getToken: (() => Promise<string | null>) | null = null;
// Provides the Auth0 user's email for the x-user-email fallback (dev-mode server).
let _getUserEmail: (() => string | null) | null = null;
// Set to true once Auth0 has finished loading (isLoading=false), regardless of auth state.
let _auth0Ready = false;
export function setTokenGetter(fn: (() => Promise<string | null>) | null) { _getToken = fn; }
export function setUserEmailGetter(fn: (() => string | null) | null) { _getUserEmail = fn; }
export function setAuth0Ready(ready: boolean) { _auth0Ready = ready; }

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: string } = {}): Promise<T> {
  // Wait up to 3 s for Auth0 to finish loading before sending the request,
  // so pages that call api() in useEffect([]) don't race Auth0's session restore.
  if (!_auth0Ready) {
    for (let i = 0; i < 30 && !_auth0Ready; i++) await new Promise(r => setTimeout(r, 100));
  }
  const headers: Record<string, string> = { 'Content-Type': opts.raw ? 'text/csv' : 'application/json' };

  // Production: attach Auth0 access token as Bearer.
  if (_getToken) {
    try { const t = await _getToken(); if (t) headers['Authorization'] = `Bearer ${t}`; } catch { /* not signed in */ }
  }
  // Dev-mode server fallback: send x-user-email so AUTH_MODE=dev still works locally.
  const email = _getUserEmail?.() || 'demo@covisor.com';
  headers['x-user-email'] = email;

  const res = await fetch(API_BASE + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)
  });
  // Resilient parse: an empty body (204/304) or a non-JSON error page must not
  // surface as "Unexpected end of JSON input", so fall back to a clear message.
  const text = await res.text();
  let j: { error?: string } = {};
  if (text) { try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; } }
  if (!res.ok) throw Object.assign(new Error(j.error || res.statusText || `Request failed (${res.status})`), { status: res.status, data: j });
  return j as T;
}
export const fmt = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmt0 = (n: number) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
export const COLORS: Record<string, string> = {
 'Rent & Housing':'#e8590c','Loan Payments':'#e03131','P2P & Transfers':'#2f9e44','Education':'#66a80f',
 'Credit Card Payments':'#f08c00','Shopping':'#7048e8','Groceries & Household':'#37b24d','Legal & Court':'#c2255c',
 'Dining & Fast Food':'#0ca678','Insurance':'#099268','Utilities & Bills':'#0b7285','Gas & Convenience':'#1c7ed6',
 'Entertainment':'#f76707','Savings & Investments':'#4263eb','Subscriptions & Digital':'#ae3ec9','Health & Pharmacy':'#15aabf',
 'Gym & Fitness':'#d6336c','Auto':'#fd7e14','Cash Withdrawals':'#9c36b5','Vape & Tobacco':'#94a000',
 'Bars & Nightlife':'#e8b500','Personal Care':'#d9480f','Fees':'#868e96','Taxes':'#228be6','Other':'#adb5bd','Income':'#188d49','Refunds':'#2b8a3e','Income & Refunds':'#188d49'
};
export const color = (c: string) => COLORS[c] || '#adb5bd';

// Donut slices: the top N categories plus a single rolled-up "Other". Any remainder
// is folded INTO an existing "Other" category so a legend never shows two "Other" rows.
export function donutData(cats: { name: string; total: number }[], n = 9): { name: string; total: number }[] {
  const top = cats.slice(0, n).map(c => ({ name: c.name, total: c.total }));
  const rest = cats.slice(n).reduce((s, c) => s + c.total, 0);
  if (rest > 0) {
    const other = top.find(d => d.name === 'Other');
    if (other) other.total += rest; else top.push({ name: 'Other', total: rest });
  }
  return top;
}
// Display label for a plan key (internal key "family" shows as "Personal+").
export const planLabel = (p?: string) => ({ free: 'Free', personal: 'Personal', family: 'Personal+', enterprise: 'Enterprise' } as Record<string, string>)[p || ''] || p || '—';

// ---- profile helpers ----
import type { Profile } from './types';
import { mockProfile } from './mock';

export function initials(name: string): string {
  const s = (name || '').replace(/@.*$/, '').trim();
  const parts = s.split(/[.\s_-]+/).filter(Boolean);
  const a = parts[0]?.[0] || s[0] || '?';
  const b = parts[1]?.[0] || '';
  return (a + b).toUpperCase();
}

// Phase 1: hydrate from the existing /api/me, fill the rest with mock so the
// page renders today. Phase 2 swaps this for GET /api/me/profile.
export async function getProfile(): Promise<Profile> {
  try {
    const me = await api<{ id: string; email: string; plan: string; display_name?: string | null }>('/api/me');
    return mockProfile({ id: me.id, email: me.email, plan: me.plan, displayName: me.display_name || undefined });
  } catch {
    return mockProfile();
  }
}

// Relative "time ago" for sessions/activity.
export function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`;
  const mo = d / 30; if (mo < 12) return `${Math.floor(mo)}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// Date formatter honoring the saved date-format preference.
export function fmtDate(iso: string | undefined, format = 'MM/DD/YYYY'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(+d)) return '—';
  const Y = d.getFullYear(), M = d.getMonth() + 1, D = d.getDate();
  const p = (n: number) => String(n).padStart(2, '0');
  const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  switch (format) {
    case 'DD/MM/YYYY': return `${p(D)}/${p(M)}/${Y}`;
    case 'YYYY-MM-DD': return `${Y}-${p(M)}-${p(D)}`;
    case 'D MMM YYYY': return `${D} ${MON[d.getMonth()]} ${Y}`;
    default: return `${p(M)}/${p(D)}/${Y}`;
  }
}

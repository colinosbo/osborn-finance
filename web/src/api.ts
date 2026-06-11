// API client. Dev auth: x-user-email header (Entra JWT in prod).
const EMAIL_KEY = 'of_dev_email';
export function getEmail() { return localStorage.getItem(EMAIL_KEY) || 'demo@osbornfinance.com'; }
export function setEmail(e: string) { localStorage.setItem(EMAIL_KEY, e); }
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; raw?: string } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'x-user-email': getEmail(), 'Content-Type': opts.raw ? 'text/csv' : 'application/json' },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)
  });
  const j = await res.json();
  if (!res.ok) throw Object.assign(new Error(j.error || res.statusText), { status: res.status, data: j });
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
 'Bars & Nightlife':'#e8b500','Personal Care':'#d9480f','Fees':'#868e96','Taxes':'#228be6','Other':'#adb5bd','Income & Refunds':'#188d49'
};
export const color = (c: string) => COLORS[c] || '#adb5bd';

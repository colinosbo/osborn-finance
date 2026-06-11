import { useEffect, useState } from 'react';
import { api, getEmail, setEmail } from '../api';
import type { Toast } from '../App';

export default function Settings({ toast }: { toast: Toast }) {
  const [me, setMe] = useState<{ email: string; plan: string } | null>(null);
  const [email, setEmailInput] = useState(getEmail());
  useEffect(() => { api<{ email: string; plan: string }>('/api/me').then(setMe); }, []);
  const exportData = async () => {
    const data = await api('/api/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'osborn-finance-export.json'; a.click();
    toast('Export downloaded');
  };
  const portal = async () => {
    try { const r = await api<{ url: string; mock: boolean }>('/api/billing/portal', { method: 'POST' }); r.mock ? toast('Stripe Customer Portal opens here with live keys') : (window.location.href = r.url); }
    catch (e) { toast((e as Error).message); }
  };
  const del = async () => {
    if (!confirm('Permanently delete your account, all transactions, and bank connections?')) return;
    await api('/api/me', { method: 'DELETE' });
    toast('Account deleted'); setMe(null);
  };
  return (
    <>
      <div className="sec-head"><span className="sec-num">07</span><span className="sec-title">Settings</span></div>
      <div className="sec-sub">Profile, billing, security &amp; data</div>
      <div className="row2">
        <div className="panel">
          <h3>Profile</h3><div className="psub">Dev mode: identity is the email header. Production: Entra External ID with MFA.</div>
          <div className="controls">
            <input value={email} onChange={e => setEmailInput(e.target.value)} style={{ flex: 1 }} />
            <button className="btn" onClick={() => { setEmail(email); toast('Switched user (dev)'); location.reload(); }}>Switch user</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--faint)' }}>Signed in as {me?.email || '…'} · plan: {me?.plan || '…'}</div>
        </div>
        <div className="panel">
          <h3>Billing</h3><div className="psub">Managed by Stripe — card data never touches our servers</div>
          <button className="btn" onClick={portal}>Open billing portal</button>
        </div>
      </div>
      <div className="panel" style={{ marginTop: 24 }}>
        <h3>Security &amp; data</h3><div className="psub">Your data is yours — take it or erase it any time (GLBA/CCPA)</div>
        <div className="controls">
          <button className="btn" onClick={exportData}>Export all my data (JSON)</button>
          <button className="btn danger" onClick={del}>Delete my account</button>
        </div>
      </div>
    </>
  );
}

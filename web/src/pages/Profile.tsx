import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, getProfile, getEmail, setEmail, initials, ago, fmtDate, planLabel } from '../api';
import { loadPrefs, savePrefs } from '../prefs';
import { ACTIVITY_LABEL } from '../mock';
import type { Profile as ProfileT, Session } from '../types';
import type { Toast } from '../App';

// Phase 1: password / MFA / security-info / email actions are mock handlers. In
// production they deep-link to Entra External ID (self-service password reset,
// security info / combined registration) — the app never handles credentials.
const ENTRA_NOTE = 'In production this opens your Entra External ID security page.';

type SectionId =
  | 'personal' | 'email' | 'password'
  | 'mfa' | 'secinfo' | 'alerts'
  | 'devices' | 'activity'
  | 'banks' | 'billing'
  | 'export' | 'delete'
  | 'dev';

const NAV: { group: string; items: { id: SectionId; label: string; ico: string }[] }[] = [
  { group: 'Account management', items: [
    { id: 'personal', label: 'Personal information', ico: '👤' },
    { id: 'email', label: 'Email address', ico: '✉️' },
    { id: 'password', label: 'Password', ico: '🔑' }
  ] },
  { group: 'Security', items: [
    { id: 'mfa', label: 'Multi-factor auth', ico: '🛡️' },
    { id: 'secinfo', label: 'Security information', ico: '🔐' },
    { id: 'alerts', label: 'Sign-in alerts', ico: '🔔' }
  ] },
  { group: 'Sessions & activity', items: [
    { id: 'devices', label: 'Active devices', ico: '💻' },
    { id: 'activity', label: 'Recent activity', ico: '🕑' }
  ] },
  { group: 'Connected accounts', items: [
    { id: 'banks', label: 'Linked banks', ico: '🏦' },
    { id: 'billing', label: 'Plan & billing', ico: '◆' }
  ] },
  { group: 'Privacy & data', items: [
    { id: 'export', label: 'Export your data', ico: '⤓' },
    { id: 'delete', label: 'Account deletion', ico: '⚠️' }
  ] },
  { group: 'Developer', items: [
    { id: 'dev', label: 'Switch user (dev)', ico: '🧪' }
  ] }
];

// Module-level so it isn't recreated on every render — defining it inside the
// component made React remount the panel (and its inputs) on each keystroke,
// dropping focus mid-typing.
function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="panel">
      <h3>{title}</h3>{sub && <div className="psub">{sub}</div>}
      {children}
    </div>
  );
}

export default function Profile({ toast }: { toast: Toast }) {
  const df = loadPrefs().dateFormat;
  const [p, setP] = useState<ProfileT | null>(null);
  const [accts, setAccts] = useState<{ items: unknown[]; accounts: unknown[] }>({ items: [], accounts: [] });
  const [active, setActive] = useState<SectionId>('personal');

  // edit buffers
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ displayName: '', preferredName: '', phone: '' });
  const [emailForm, setEmailForm] = useState('');
  const [editEmail, setEditEmail] = useState(false);
  const [rec, setRec] = useState({ recoveryEmail: '', recoveryPhone: '' });
  const [editRec, setEditRec] = useState(false);
  const [devEmail, setDevEmail] = useState(getEmail());

  useEffect(() => {
    getProfile().then(pr => {
      setP(pr);
      setForm({ displayName: pr.displayName, preferredName: pr.preferredName || '', phone: pr.phone || '' });
      setEmailForm(pr.email);
      setRec({ recoveryEmail: pr.security.recoveryEmail || '', recoveryPhone: pr.security.recoveryPhone || '' });
    });
    api<{ items: unknown[]; accounts: unknown[] }>('/api/accounts').then(setAccts).catch(() => {});
  }, []);

  const completeness = useMemo(() => {
    if (!p) return 0;
    const checks = [!!form.displayName, !!form.preferredName, !!form.phone, p.security.mfaEnabled, !!p.security.recoveryEmail, p.emailVerified];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [p, form]);

  if (!p) return <div className="empty">Loading profile…</div>;

  const savePersonal = () => {
    setP({ ...p, displayName: form.displayName, preferredName: form.preferredName, phone: form.phone });
    setEditing(false); toast('Profile saved');
  };
  const saveRecovery = () => {
    setP({ ...p, security: { ...p.security, recoveryEmail: rec.recoveryEmail, recoveryPhone: rec.recoveryPhone } });
    setEditRec(false); toast('Security information updated');
  };
  const toggleMfa = () => {
    const on = !p.security.mfaEnabled;
    setP({ ...p, security: { ...p.security, mfaEnabled: on, methods: on ? ['app'] : [], authenticatorApp: on, lastMfaUpdate: new Date().toISOString() } });
    toast(on ? 'MFA enabled (demo) — Entra-managed in production' : 'MFA disabled (demo)');
  };
  const revoke = (s: Session) => {
    if (s.current) { toast('Use “Sign out everywhere” for the current session'); return; }
    setP({ ...p, sessions: p.sessions.filter(x => x.id !== s.id) }); toast('Session revoked');
  };
  const signOutEverywhere = () => {
    if (!confirm('Sign out of all sessions on all devices?')) return;
    setP({ ...p, sessions: p.sessions.filter(s => s.current) }); toast('Signed out everywhere (other devices)');
  };
  const exportData = async () => {
    const data = await api('/api/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'osborn-finance-export.json'; a.click();
    toast('Export downloaded');
  };
  const del = async () => {
    if (!confirm('Permanently delete your account, all transactions, and bank connections?')) return;
    await api('/api/me', { method: 'DELETE' }); toast('Account deleted'); setP(null);
  };
  const portal = async () => {
    try { const r = await api<{ url: string; mock: boolean }>('/api/billing/portal', { method: 'POST' }); r.mock ? toast('Stripe Customer Portal opens here with live keys') : (window.location.href = r.url); }
    catch (e) { toast((e as Error).message); }
  };
  const copyId = () => { navigator.clipboard?.writeText(p.id); toast('User ID copied'); };
  const toggleLoginAlerts = () => {
    const pr = loadPrefs(); const next = { ...pr, loginAlerts: !pr.loginAlerts }; savePrefs(next);
    toast(`Sign-in alerts ${next.loginAlerts ? 'on' : 'off'}`); setP({ ...p }); // re-render
  };

  const content = () => {
    switch (active) {
      case 'personal': return (
        <Section title="Personal information" sub="Name and contact details shown across Osborn Finance.">
          {!editing ? (<>
            <div className="kv"><span>Display name</span><b>{p.displayName || '—'}</b></div>
            <div className="kv"><span>Preferred name</span><b>{p.preferredName || '—'}</b></div>
            <div className="kv"><span>Phone</span><b>{p.phone || '—'}</b></div>
            <div className="kv"><span>User ID</span><b className="mono">{p.id} <button className="copybtn" onClick={copyId}>copy</button></b></div>
            <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}>
              <button className="btn" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn" onClick={() => toast('Photo upload connects to storage in production')}>Change photo</button>
            </div>
          </>) : (<>
            <label className="fld"><span>Display name</span><input value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} /></label>
            <label className="fld"><span>Preferred name</span><input value={form.preferredName} onChange={e => setForm({ ...form, preferredName: e.target.value })} placeholder="optional" /></label>
            <label className="fld"><span>Phone</span><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+1 555 123 4567" /></label>
            <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}>
              <button className="btn primary" onClick={savePersonal}>Save</button>
              <button className="btn" onClick={() => { setForm({ displayName: p.displayName, preferredName: p.preferredName || '', phone: p.phone || '' }); setEditing(false); }}>Cancel</button>
            </div>
          </>)}
        </Section>
      );
      case 'email': return (
        <Section title="Email address" sub="Your sign-in email. Managed by Entra External ID in production.">
          <div className="kv"><span>Current email</span><b>{p.email} {p.emailVerified && <span className="verified">✓ verified</span>}</b></div>
          {!editEmail ? (
            <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}><button className="btn" onClick={() => setEditEmail(true)}>Change email</button></div>
          ) : (<>
            <label className="fld" style={{ marginTop: 12 }}><span>New email</span><input value={emailForm} onChange={e => setEmailForm(e.target.value)} /></label>
            <div className="callout">Changing your email requires re-verification through Entra in production.</div>
            <div className="controls" style={{ marginTop: 14, marginBottom: 0 }}>
              <button className="btn primary" onClick={() => { setEditEmail(false); toast(ENTRA_NOTE); }}>Send verification</button>
              <button className="btn" onClick={() => { setEmailForm(p.email); setEditEmail(false); }}>Cancel</button>
            </div>
          </>)}
        </Section>
      );
      case 'password': return (
        <Section title="Password" sub="Passwords are managed by Entra External ID — never stored by Osborn Finance.">
          <div className="kv"><span>Last changed</span><b>{fmtDate(p.security.lastPasswordChange, df)}</b></div>
          <div className="callout">For your security, password changes happen on the Entra-hosted self-service page.</div>
          <div className="controls" style={{ marginTop: 14, marginBottom: 0 }}><button className="btn primary" onClick={() => toast(ENTRA_NOTE)}>Change password</button></div>
        </Section>
      );
      case 'mfa': return (
        <Section title="Multi-factor authentication" sub="Add a second step at sign-in. Strongly recommended.">
          <div className="secrow">
            <div className="lab"><b>Status <span className={'statusdot ' + (p.security.mfaEnabled ? 'on' : 'off')} /></b>
              <span>{p.security.mfaEnabled ? `Enabled · ${p.security.methods.join(', ') || 'authenticator app'}` : 'Not enabled'}</span></div>
            <button className="btn" onClick={toggleMfa}>{p.security.mfaEnabled ? 'Disable' : 'Enable'}</button>
          </div>
          <div className="secrow">
            <div className="lab"><b>Last updated</b><span>{p.security.lastMfaUpdate ? fmtDate(p.security.lastMfaUpdate, df) : '—'}</span></div>
            <button className="btn" onClick={() => toast(ENTRA_NOTE)}>Manage methods</button>
          </div>
          <div className="callout">In production, enrollment uses Entra's combined security-info registration and is enforced by Conditional Access.</div>
        </Section>
      );
      case 'secinfo': return (
        <Section title="Security information" sub="Recovery methods used to verify it's really you.">
          {!editRec ? (<>
            <div className="kv"><span>Recovery email</span><b>{p.security.recoveryEmail || '—'}</b></div>
            <div className="kv"><span>Recovery phone</span><b>{p.security.recoveryPhone || '—'}</b></div>
            <div className="kv"><span>Authenticator app</span><b>{p.security.authenticatorApp ? 'Registered' : 'Not registered'}</b></div>
            <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}><button className="btn" onClick={() => setEditRec(true)}>Edit recovery methods</button></div>
          </>) : (<>
            <label className="fld"><span>Recovery email</span><input value={rec.recoveryEmail} onChange={e => setRec({ ...rec, recoveryEmail: e.target.value })} placeholder="backup@email.com" /></label>
            <label className="fld"><span>Recovery phone</span><input value={rec.recoveryPhone} onChange={e => setRec({ ...rec, recoveryPhone: e.target.value })} placeholder="+1 555 123 4567" /></label>
            <div className="controls" style={{ marginTop: 14, marginBottom: 0 }}>
              <button className="btn primary" onClick={saveRecovery}>Save</button>
              <button className="btn" onClick={() => { setRec({ recoveryEmail: p.security.recoveryEmail || '', recoveryPhone: p.security.recoveryPhone || '' }); setEditRec(false); }}>Cancel</button>
            </div>
          </>)}
        </Section>
      );
      case 'alerts': return (
        <Section title="Sign-in alerts" sub="Get notified about new or unusual sign-ins.">
          <div className="switchrow">
            <div className="lab"><b>Email me on new-device sign-in</b><span>Delivered once email is live</span></div>
            <div className={'switch' + (loadPrefs().loginAlerts ? ' on' : '')} role="switch" aria-checked={loadPrefs().loginAlerts} tabIndex={0}
              onClick={toggleLoginAlerts} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') toggleLoginAlerts(); }}><i /></div>
          </div>
        </Section>
      );
      case 'devices': return (
        <Section title="Active devices" sub="Where you’re currently signed in.">
          {p.sessions.map(s => (
            <div key={s.id} className="sesrow">
              <div className="sesmeta"><b>{s.device} {s.current && <span className="curtag">this device</span>}</b><span>{s.location} · {ago(s.lastActive)}</span></div>
              {!s.current && <button className="btn" onClick={() => revoke(s)}>Revoke</button>}
            </div>
          ))}
          <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}><button className="btn danger" onClick={signOutEverywhere}>Sign out everywhere</button></div>
        </Section>
      );
      case 'activity': return (
        <Section title="Recent activity" sub="Sign-ins and account changes.">
          {p.activity.map(a => (
            <div key={a.id} className="lrow"><span className="name">{ACTIVITY_LABEL[a.event] || a.event}{a.detail ? ` · ${a.detail}` : ''}</span>
              <span className="val" style={{ color: 'var(--faint)', fontWeight: 550 }}>{ago(a.at)}</span></div>
          ))}
        </Section>
      );
      case 'banks': return (
        <Section title="Linked banks" sub="Bank connections through Plaid.">
          <div className="kv"><span>Linked banks</span><b>{accts.items.length}</b></div>
          <div className="kv"><span>Accounts</span><b>{accts.accounts.length}</b></div>
          <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}><Link to="/accounts" className="btn">Manage banks</Link></div>
        </Section>
      );
      case 'billing': return (
        <Section title="Plan & billing" sub="Managed by Stripe — card data never touches our servers.">
          <div className="kv"><span>Current plan</span><b>{planLabel(p.plan)}</b></div>
          <div className="controls" style={{ marginTop: 16, marginBottom: 0 }}>
            <button className="btn" onClick={portal}>Open billing portal</button>
            <Link to="/plans" className="btn">Change plan</Link>
          </div>
        </Section>
      );
      case 'export': return (
        <Section title="Export your data" sub="Take everything with you any time (GLBA/CCPA).">
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Download all transactions, accounts, and category overrides as JSON.</p>
          <div className="controls" style={{ marginBottom: 0 }}><button className="btn primary" onClick={exportData}>Export all my data (JSON)</button></div>
        </Section>
      );
      case 'delete': return (
        <Section title="Account deletion" sub="Permanently erase your account and data.">
          <div className="callout danger">This removes your transactions, bank connections, and profile. Audit records are retained per policy. This cannot be undone.</div>
          <div className="controls" style={{ marginTop: 14, marginBottom: 0 }}><button className="btn danger" onClick={del}>Delete my account</button></div>
        </Section>
      );
      case 'dev': return (
        <Section title="Switch user (dev)" sub="Dev mode only — identity is the x-user-email header. Production uses Entra SSO.">
          <label className="fld"><span>Email</span><input value={devEmail} onChange={e => setDevEmail(e.target.value)} /></label>
          <div className="controls" style={{ marginBottom: 0 }}><button className="btn" onClick={() => { setEmail(devEmail); toast('Switched user (dev)'); location.reload(); }}>Switch user</button></div>
        </Section>
      );
    }
  };

  return (
    <>
      <div className="sec-head"><span className="sec-num">08</span><span className="sec-title">Profile</span></div>
      <div className="sec-sub">Manage your account, security, sessions &amp; privacy</div>

      {/* identity header */}
      <div className="panel idhead" style={{ marginBottom: 24 }}>
        <div className="avatar avatar-lg" aria-hidden>{initials(p.displayName || p.email)}</div>
        <div className="idinfo">
          <div className="idname">{p.displayName}{p.preferredName ? <span className="idpref"> “{p.preferredName}”</span> : null}</div>
          <div className="idmeta">{p.email} {p.emailVerified && <span className="verified">✓ verified</span>}</div>
          <div className="idmeta">Member since {fmtDate(p.memberSince, df)}</div>
        </div>
        <div className="idright">
          <span className="badge">{planLabel(p.plan)} plan</span>
          <div className="meterwrap" title={`Profile ${completeness}% complete`}>
            <div className="meter"><div className="meter-fill" style={{ width: completeness + '%' }} /></div>
            <span className="metertxt">{completeness}% complete</span>
          </div>
        </div>
      </div>

      {/* hub: category sidebar + content */}
      <div className="proflayout">
        <aside className="profnav">
          {NAV.map(g => (
            <div className="profgroup" key={g.group}>
              <div className="profgroup-title">{g.group}</div>
              {g.items.map(it => (
                <button key={it.id} className={'profnav-item' + (active === it.id ? ' active' : '')} onClick={() => setActive(it.id)}>
                  <span className="pni-ico">{it.ico}</span>{it.label}
                </button>
              ))}
            </div>
          ))}
        </aside>
        <div className="profcontent">{content()}</div>
      </div>
    </>
  );
}

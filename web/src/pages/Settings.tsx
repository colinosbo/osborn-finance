import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, planLabel } from '../api';
import { loadPrefs, savePrefs, applyMotionPref, CURRENCIES, DATE_FORMATS, TIMEZONES, type Prefs } from '../prefs';
import type { Toast } from '../App';

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <div className={'switch' + (on ? ' on' : '')} role="switch" aria-checked={on} tabIndex={0}
      onClick={onToggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}>
      <i />
    </div>
  );
}

const THEMES: { id: string; label: string; sw: string; ring: string }[] = [
  { id: 'gray', label: 'Gray', sw: '#17181a', ring: '#292a2d' },
  { id: 'light', label: 'White', sw: '#ffffff', ring: '#dcd5ee' },
  { id: 'purple', label: 'Purple', sw: '#1a1427', ring: '#3a2f5a' }
];

export default function Settings({ toast, theme, setTheme }: { toast: Toast; theme: string; setTheme: (v: string) => void }) {
  const [me, setMe] = useState<{ email: string; plan: string } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs());
  useEffect(() => { api<{ email: string; plan: string }>('/api/me').then(setMe).catch(() => {}); }, []);

  // Notification toggles persist immediately; format selects batch behind "Save".
  const toggle = (k: keyof Prefs, label: string) => {
    const next = { ...prefs, [k]: !prefs[k] } as Prefs;
    setPrefs(next); savePrefs(next);
    if (k === 'reduceMotion') applyMotionPref(); // take effect immediately
    toast(`${label} ${next[k] ? 'on' : 'off'}`);
  };
  const savePreferences = () => { savePrefs(prefs); toast('Preferences saved'); };

  const portal = async () => {
    try { const r = await api<{ url: string; mock: boolean }>('/api/billing/portal', { method: 'POST' }); r.mock ? toast('Stripe Customer Portal opens here with live keys') : (window.location.href = r.url); }
    catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <div className="sec-head"><span className="sec-num">07</span><span className="sec-title">Settings</span></div>
      <div className="sec-sub">Appearance, preferences, notifications, security &amp; billing</div>

      <div className="panel" style={{ marginBottom: 24 }}>
        <h3>Appearance</h3><div className="psub">How Covisor looks on this device</div>
        <div className="switchrow">
          <div className="lab"><b>Theme</b><span>Gray by default, or switch to White or Purple</span></div>
          <div className="themepick">
            {THEMES.map(t => (
              <button key={t.id} type="button" className={'themeopt' + (theme === t.id ? ' sel' : '')}
                onClick={() => { setTheme(t.id); toast(`${t.label} theme on`); }} aria-pressed={theme === t.id}>
                <span className="themeopt-sw" style={{ background: t.sw, borderColor: t.ring }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="switchrow">
          <div className="lab"><b>Reduce motion</b><span>Minimize animations and transitions</span></div>
          <Switch on={prefs.reduceMotion} onToggle={() => toggle('reduceMotion', 'Reduce motion')} />
        </div>
      </div>

      <div className="row2">
        <div className="panel">
          <h3>Preferences</h3><div className="psub">Currency, date &amp; default views</div>
          <label className="fld"><span>Currency</span>
            <select value={prefs.currency} onChange={e => setPrefs({ ...prefs, currency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select></label>
          <label className="fld"><span>Date format</span>
            <select value={prefs.dateFormat} onChange={e => setPrefs({ ...prefs, dateFormat: e.target.value })}>
              {DATE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select></label>
          <label className="fld"><span>Time zone</span>
            <select value={prefs.timezone} onChange={e => setPrefs({ ...prefs, timezone: e.target.value })}>
              {TIMEZONES.map(t => <option key={t} value={t}>{t}</option>)}
            </select></label>
          <div className="controls" style={{ marginTop: 14, marginBottom: 0 }}>
            <button className="btn primary" onClick={savePreferences}>Save preferences</button>
          </div>
        </div>

        <div className="panel">
          <h3>Notifications</h3><div className="psub">What we email you about (delivered once email is live)</div>
          <div className="switchrow">
            <div className="lab"><b>Weekly digest</b><span>A Monday summary of last week’s spending</span></div>
            <Switch on={prefs.emailDigest} onToggle={() => toggle('emailDigest', 'Weekly digest')} />
          </div>
          <div className="switchrow">
            <div className="lab"><b>Spending alerts</b><span>Large or unusual transactions</span></div>
            <Switch on={prefs.spendingAlerts} onToggle={() => toggle('spendingAlerts', 'Spending alerts')} />
          </div>
          <div className="switchrow">
            <div className="lab"><b>Budget alerts</b><span>When a category hits 80% / 100%</span></div>
            <Switch on={prefs.budgetAlerts} onToggle={() => toggle('budgetAlerts', 'Budget alerts')} />
          </div>
          <div className="switchrow">
            <div className="lab"><b>New sign-in alerts</b><span>Email when a new device signs in</span></div>
            <Switch on={prefs.loginAlerts} onToggle={() => toggle('loginAlerts', 'Sign-in alerts')} />
          </div>
        </div>
      </div>

      <div className="row2">
        <div className="panel">
          <h3>Security</h3><div className="psub">Password &amp; MFA are managed by Entra External ID</div>
          <div className="secrow">
            <div className="lab"><b>Multi-factor authentication</b><span>Enroll or change methods on your security page</span></div>
            <button className="btn" onClick={() => toast('In production this opens your Entra security page')}>Manage MFA</button>
          </div>
          <div className="secrow">
            <div className="lab"><b>Identity, sessions &amp; data</b><span>Profile, devices, export &amp; account deletion</span></div>
            <Link to="/profile" className="btn">Open profile →</Link>
          </div>
        </div>

        <div className="panel">
          <h3>Billing</h3><div className="psub">Managed by Stripe, card data never touches our servers</div>
          <div style={{ fontSize: 13, marginBottom: 14 }}>Current plan: <b>{me ? planLabel(me.plan) : '…'}</b></div>
          <div className="controls" style={{ marginBottom: 0 }}>
            <button className="btn" onClick={portal}>Open billing portal</button>
            <Link to="/plans" className="btn">Change plan</Link>
          </div>
        </div>
      </div>
    </>
  );
}

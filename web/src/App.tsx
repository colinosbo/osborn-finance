import { Routes, Route, NavLink, Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Ledger from './pages/Ledger';
import Advisor from './pages/Advisor';
import Budgets from './pages/Budgets';
import Reports from './pages/Reports';
import Plans from './pages/Plans';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Subscriptions from './pages/Subscriptions';
import Welcome from './pages/Welcome';
import { api } from './api';
import { applyMotionPref } from './prefs';
import { Icon, type IconName } from './icons';

export type Toast = (msg: string) => void;

const TABS: { to: string; ico: IconName; label: string }[] = [
  { to: '/', ico: 'dashboard', label: 'Dashboard' },
  { to: '/accounts', ico: 'bank', label: 'Accounts' },
  { to: '/ledger', ico: 'ledger', label: 'Ledger' },
  { to: '/advisor', ico: 'advisor', label: 'Advisor' },
  { to: '/budgets', ico: 'budgets', label: 'Budgets' },
  { to: '/reports', ico: 'reports', label: 'Reports' },
  { to: '/subscriptions', ico: 'subscriptions', label: 'Subscriptions' },
  { to: '/plans', ico: 'plans', label: 'Plans' }
];

export default function App() {
  const [toast, setToastMsg] = useState('');
  const showToast: Toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3200); };
  // dark mode — ON by default; persisted per device
  const [dark, setDark] = useState(() => (localStorage.getItem('of_theme') ?? 'dark') !== 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('of_theme', dark ? 'dark' : 'light');
  }, [dark]);
  useEffect(() => { applyMotionPref(); }, []);
  // Soft welcome: first-time free users land on the welcome screen (dismissable).
  const navigate = useNavigate();
  useEffect(() => {
    if (sessionStorage.getItem('of_welcomed') || window.location.pathname !== '/') return;
    api<{ plan: string }>('/api/me').then(m => { if (m.plan === 'free') navigate('/welcome', { replace: true }); }).catch(() => {});
  }, [navigate]);
  return (
    <>
      <nav>
        <div className="nav-inner">
          <Link to="/" className="brand" title="Home">Osborn <span className="grad">Finance</span></Link>
          <div className="navtabs">
            {TABS.map(t => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => 'navtab' + (isActive ? ' active' : '')}>
                <span className="ico"><Icon name={t.ico} /></span>{t.label}
              </NavLink>
            ))}
          </div>
          <div className="navright">
            <NavLink to="/profile" className={({ isActive }) => 'navtab' + (isActive ? ' active' : '')}>
              <span className="ico"><Icon name="profile" /></span>Profile
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => 'navtab' + (isActive ? ' active' : '')}>
              <span className="ico"><Icon name="settings" /></span>Settings
            </NavLink>
          </div>
        </div>
      </nav>
      <div className="wrap">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts toast={showToast} />} />
          <Route path="/ledger" element={<Ledger toast={showToast} />} />
          <Route path="/advisor" element={<Advisor />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/reports" element={<Reports toast={showToast} />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/welcome" element={<Welcome />} />
          <Route path="/plans" element={<Plans toast={showToast} />} />
          <Route path="/profile" element={<Profile toast={showToast} />} />
          <Route path="/settings" element={<Settings toast={showToast} dark={dark} setDark={setDark} />} />
        </Routes>
      </div>
      {toast && <div className="toastbox">{toast}</div>}
    </>
  );
}

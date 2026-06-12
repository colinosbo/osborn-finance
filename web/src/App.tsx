import { Routes, Route, NavLink, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Ledger from './pages/Ledger';
import Advisor from './pages/Advisor';
import Budgets from './pages/Budgets';
import Reports from './pages/Reports';
import Plans from './pages/Plans';
import Settings from './pages/Settings';

export type Toast = (msg: string) => void;

const TABS = [
  { to: '/', ico: '📊', label: 'Dashboard' },
  { to: '/accounts', ico: '🏦', label: 'Accounts' },
  { to: '/ledger', ico: '📒', label: 'Ledger' },
  { to: '/advisor', ico: '✦', label: 'Advisor' },
  { to: '/budgets', ico: '🎯', label: 'Budgets' },
  { to: '/reports', ico: '📈', label: 'Reports' },
  { to: '/plans', ico: '◆', label: 'Plans' }
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
  return (
    <>
      <nav>
        <div className="nav-inner">
          <Link to="/" className="brand" title="Home">Osborn <span className="grad">Finance</span></Link>
          <div className="navtabs">
            {TABS.map(t => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => 'navtab' + (isActive ? ' active' : '')}>
                <span className="ico">{t.ico}</span>{t.label}
              </NavLink>
            ))}
          </div>
          <div className="navright">
            <NavLink to="/settings" className={({ isActive }) => 'navtab' + (isActive ? ' active' : '')}>
              <span className="ico">⚙</span>Settings
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
          <Route path="/reports" element={<Reports />} />
          <Route path="/plans" element={<Plans toast={showToast} />} />
          <Route path="/settings" element={<Settings toast={showToast} dark={dark} setDark={setDark} />} />
        </Routes>
      </div>
      {toast && <div className="toastbox">{toast}</div>}
    </>
  );
}

import { Routes, Route, NavLink, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Ledger from './pages/Ledger';
import Advisor from './pages/Advisor';
import Budgets from './pages/Budgets';
import Goals from './pages/Goals';
import Reports from './pages/Reports';
import Plans from './pages/Plans';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import Subscriptions from './pages/Subscriptions';
import { applyMotionPref } from './prefs';
import { Icon, type IconName } from './icons';

export type Toast = (msg: string) => void;

const TABS: { to: string; ico: IconName; label: string }[] = [
  { to: '/', ico: 'dashboard', label: 'Dashboard' },
  { to: '/accounts', ico: 'bank', label: 'Accounts' },
  { to: '/ledger', ico: 'ledger', label: 'Ledger' },
  { to: '/advisor', ico: 'advisor', label: 'Advisor' },
  { to: '/budgets', ico: 'budgets', label: 'Budgets' },
  { to: '/goals', ico: 'goal', label: 'Goals' },
  { to: '/reports', ico: 'reports', label: 'Reports' },
  { to: '/subscriptions', ico: 'subscriptions', label: 'Subscriptions' },
  { to: '/plans', ico: 'plans', label: 'Plans' }
];
// Drawer (mobile only) shows the same destinations plus Profile & Settings.
const DRAWER_LINKS: { to: string; ico: IconName; label: string }[] = [
  ...TABS,
  { to: '/profile', ico: 'profile', label: 'Profile' },
  { to: '/settings', ico: 'settings', label: 'Settings' }
];

export default function App() {
  const [toast, setToastMsg] = useState('');
  const showToast: Toast = (m) => { setToastMsg(m); setTimeout(() => setToastMsg(''), 3200); };
  // theme: steel (default) | light | purple; persisted per device.
  // Migrate the old boolean value: 'dark' was the purple theme.
  const [theme, setTheme] = useState(() => {
    const s = localStorage.getItem('of_theme');
    return s === 'dark' ? 'purple' : s === 'steel' ? 'gray' : (s || 'gray');
  });
  // mobile slide-out nav drawer
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('of_theme', theme);
  }, [theme]);
  useEffect(() => { applyMotionPref(); }, []);
  // lock background scroll while the drawer is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);
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
          {/* mobile-only hamburger */}
          <button className="navburger" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></svg>
          </button>
        </div>
      </nav>

      {/* mobile slide-out drawer (hidden on desktop via CSS) */}
      <div className={'drawer-scrim' + (menuOpen ? ' open' : '')} onClick={closeMenu} />
      <aside className={'drawer' + (menuOpen ? ' open' : '')} aria-hidden={!menuOpen}>
        <div className="drawer-head">
          <Link to="/" className="brand drawer-brand" onClick={closeMenu}>Osborn <span className="grad">Finance</span></Link>
          <button className="drawer-x" aria-label="Close menu" onClick={closeMenu}>✕</button>
        </div>
        <div className="drawer-links">
          {DRAWER_LINKS.map(t => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'} onClick={closeMenu} className={({ isActive }) => 'drawer-link' + (isActive ? ' active' : '')}>
              <span className="ico"><Icon name={t.ico} /></span>{t.label}
            </NavLink>
          ))}
        </div>
      </aside>
      <div className="wrap">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts toast={showToast} />} />
          <Route path="/ledger" element={<Ledger toast={showToast} />} />
          <Route path="/advisor" element={<Advisor />} />
          <Route path="/budgets" element={<Budgets />} />
          <Route path="/goals" element={<Goals toast={showToast} />} />
          <Route path="/reports" element={<Reports toast={showToast} />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/plans" element={<Plans toast={showToast} />} />
          <Route path="/profile" element={<Profile toast={showToast} />} />
          <Route path="/settings" element={<Settings toast={showToast} theme={theme} setTheme={setTheme} />} />
        </Routes>
      </div>
      {toast && <div className="toastbox">{toast}</div>}
    </>
  );
}

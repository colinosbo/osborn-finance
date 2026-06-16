// Single source of line icons used across the app (nav + empty states).
// Thin-stroke, currentColor, no fills — keeps the UI feeling editorial, not emoji.
export type IconName =
  | 'dashboard' | 'bank' | 'ledger' | 'advisor' | 'budgets'
  | 'reports' | 'subscriptions' | 'plans' | 'settings' | 'profile'
  | 'shield' | 'lock' | 'cloud' | 'card' | 'goal' | 'calendar'
  // empty-state aliases
  | 'chart' | 'repeat' | 'spark';

const PATHS: Record<string, JSX.Element> = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>,
  bank: <><line x1="3" y1="21" x2="21" y2="21" /><line x1="5" y1="21" x2="5" y2="10.5" /><line x1="10" y1="21" x2="10" y2="10.5" /><line x1="14" y1="21" x2="14" y2="10.5" /><line x1="19" y1="21" x2="19" y2="10.5" /><path d="M3 10.5l9-6 9 6" /></>,
  ledger: <><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="14" y2="18" /></>,
  advisor: <><path d="M12 2.5l1.6 5.4 5.4 1.6-5.4 1.6L12 16.5l-1.6-5.4L5 9.5l5.4-1.6z" /><path d="M18.5 15.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z" /></>,
  budgets: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.6" /></>,
  reports: <><polyline points="4 15 9 10 13 13 20 5" /><polyline points="15 5 20 5 20 10" /></>,
  subscriptions: <><polyline points="17 2 21 6 17 10" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><polyline points="7 22 3 18 7 14" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></>,
  plans: <><path d="M12 3l9 5.5L12 14 3 8.5z" /><path d="M3 8.5v7L12 21l9-5.5v-7" /><line x1="12" y1="14" x2="12" y2="21" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  profile: <><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.1-5.6 7-5.6s7 2 7 5.6" /></>,
  shield: <><path d="M12 3l7 2.6v5.2c0 4.3-2.9 7.4-7 8.7-4.1-1.3-7-4.4-7-8.7V5.6z" /><path d="M9 11.8l2 2 4-4" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="1.6" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  cloud: <><path d="M7 18h10.5a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.2 9.6 4.2 4.2 0 0 0 7 18z" /></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="3" y1="9.5" x2="21" y2="9.5" /></>,
  goal: <><path d="M5 21V4" /><path d="M5 4l11 0a1 1 0 0 1 .8 1.6L14 9l2.8 3.4a1 1 0 0 1-.8 1.6H5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><line x1="3.5" y1="9.5" x2="20.5" y2="9.5" /><line x1="8" y1="3" x2="8" y2="6.5" /><line x1="16" y1="3" x2="16" y2="6.5" /></>
};
// aliases so empty states can keep their semantic names
PATHS.chart = PATHS.reports;
PATHS.repeat = PATHS.subscriptions;
PATHS.spark = PATHS.advisor;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[name]}
    </svg>
  );
}

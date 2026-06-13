// Shared user preferences. Phase 1: persisted to localStorage (per device).
// Phase 2 will sync these to /api/me/preferences. Profile and Settings both
// read/write through here so there is a single source of truth.

export interface Prefs {
  currency: string;          // ISO 4217, e.g. 'USD'
  dateFormat: string;        // display format token
  timezone: string;          // IANA tz, e.g. 'America/New_York'
  defaultRangeDays: number;  // default time range for ledger/summary (0 = all)
  emailDigest: boolean;      // weekly email digest opt-in
  spendingAlerts: boolean;   // large/unusual spend alerts
  budgetAlerts: boolean;     // budget threshold alerts (80%/100%)
  loginAlerts: boolean;      // email on new-device sign-in
  reduceMotion: boolean;     // accessibility
}

const KEY = 'of_prefs';

const detectedTz = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'; }
  catch { return 'America/New_York'; }
})();

export const DEFAULTS: Prefs = {
  currency: 'USD',
  dateFormat: 'MM/DD/YYYY',
  timezone: detectedTz,
  defaultRangeDays: 365,
  emailDigest: false,
  spendingAlerts: true,
  budgetAlerts: true,
  loginAlerts: true,
  reduceMotion: false
};

export function loadPrefs(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

export function savePrefs(p: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

// Apply the reduce-motion preference to the document (CSS disables animations
// when data-reduce-motion="on"). Call on app load and whenever the toggle flips.
export function applyMotionPref(): void {
  document.documentElement.setAttribute('data-reduce-motion', loadPrefs().reduceMotion ? 'on' : 'off');
}

// Option lists for the select controls.
export const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];
export const DATE_FORMATS = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD', 'D MMM YYYY'];
export const TIMEZONES = Array.from(new Set([
  detectedTz,
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu', 'UTC',
  'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Australia/Sydney'
]));
export const RANGES: { v: number; l: string }[] = [
  { v: 30, l: 'Last 30 days' },
  { v: 90, l: 'Last 90 days' },
  { v: 365, l: 'Last 12 months' },
  { v: 0, l: 'All time' }
];

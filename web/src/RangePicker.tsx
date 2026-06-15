import { useEffect, useState } from 'react';
import { api } from './api';

// A time-range selection. The app is month-based: every range the user can pick is
// an explicit calendar month (from = the day BEFORE the 1st so the server's
// `date > from` comparison includes the 1st, and `to` is the last day of the month).
// `days` only powers the transient "all time" default used before the month list has
// loaded, and is never shown in the UI.
export interface RangeOpt { label: string; value: string; days?: number; from?: string; to?: string }

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const iso = (d: Date) => d.toISOString().slice(0, 10);

// Transient default shown only until /api/tx-months resolves; the picker then snaps
// to the most recent month with data. Not offered as a selectable option.
export const DEFAULT_RANGE: RangeOpt = { label: 'All time', value: 'all', days: 0 };

// Build a calendar-month range option from a 'YYYY-MM' string.
export function monthOpt(ym: string): RangeOpt {
  const [y, m] = ym.split('-').map(Number); // m is 1-based
  const dayBefore = new Date(Date.UTC(y, m - 1, 0)); // last day of the previous month
  const last = new Date(Date.UTC(y, m, 0));          // last day of this month
  return { label: `${MONTHS[m - 1]} ${y}`, value: `m${ym}`, from: iso(dayBefore), to: iso(last) };
}

// Query string for API calls.
export const rangeQS = (r: RangeOpt): string => r.from ? `from=${r.from}&to=${r.to}` : `days=${r.days ?? 0}`;

// Apply a range to a URLSearchParams (used when building API requests).
export function applyRange(p: URLSearchParams, r: RangeOpt): void {
  if (r.from) { p.set('from', r.from); p.set('to', r.to!); }
  else if (r.days) p.set('days', String(r.days));
}

// Resolve a range from URL params (when arriving via a link with a carried month).
export function rangeFromParams(params: URLSearchParams): RangeOpt {
  const from = params.get('from'), to = params.get('to');
  if (from && to) return monthOpt(to.slice(0, 7));
  return DEFAULT_RANGE;
}

// A single month dropdown. Lists only months you actually have data for (most recent
// 12) and auto-selects the most recent one on first load.
export default function RangePicker({ value, onChange }: { value: string; onChange: (r: RangeOpt) => void }) {
  const [months, setMonths] = useState<RangeOpt[]>([]);
  useEffect(() => {
    api<{ months: string[] }>('/api/tx-months').then(r => {
      const opts = (r.months || []).map(monthOpt);
      setMonths(opts);
      // Nothing valid selected yet (the transient default, or a carried month with no
      // data): snap to the most recent month.
      if (opts.length && !opts.some(o => o.value === value)) onChange(opts[0]);
    }).catch(() => {});
  }, []);
  const known = months.some(m => m.value === value);
  return (
    <select className="rangepick" value={known ? value : '_m'} disabled={!months.length}
      onChange={e => { const r = months.find(x => x.value === e.target.value); if (r) onChange(r); }}>
      <option value="_m" disabled hidden>{months.length ? 'Select month…' : 'No data yet'}</option>
      {months.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
    </select>
  );
}

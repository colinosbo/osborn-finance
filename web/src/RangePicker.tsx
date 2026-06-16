import { useEffect, useState } from 'react';
import { api } from './api';

// A time-range selection. The app is period-based: the user picks either a calendar
// MONTH or a calendar YEAR. `from` is the day BEFORE the first included day (so the
// server's `date > from` comparison includes it) and `to` is the last included day.
// `days` only powers the transient "all time" default used before the lists load.
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

// Build a full calendar-year range option. `from` = Dec 31 of the prior year (so
// `date > from` includes Jan 1), `to` = Dec 31 of the year.
export function yearOpt(year: number): RangeOpt {
  return { label: String(year), value: `y${year}`, from: `${year - 1}-12-31`, to: `${year}-12-31` };
}

// "All time" as a concrete from/to spanning from before the earliest year with data
// through today. Using from/to (not days) means every section's from/to-based queries
// — summary, advisor, reports, ledger — cover everything uniformly.
export function allTimeOpt(years: number[]): RangeOpt {
  const minY = years.length ? Math.min(...years) : new Date().getUTCFullYear();
  return { label: 'All time', value: 'all', from: `${minY - 1}-12-31`, to: iso(new Date()) };
}

// Query string for API calls.
export const rangeQS = (r: RangeOpt): string => r.from ? `from=${r.from}&to=${r.to}` : `days=${r.days ?? 0}`;

// Apply a range to a URLSearchParams (used when building API requests).
export function applyRange(p: URLSearchParams, r: RangeOpt): void {
  if (r.from) { p.set('from', r.from); p.set('to', r.to!); }
  else if (r.days) p.set('days', String(r.days));
}

// Resolve a range from URL params (when arriving via a link with a carried period).
// A span longer than a month is a year selection; otherwise it's a month.
export function rangeFromParams(params: URLSearchParams): RangeOpt {
  const from = params.get('from'), to = params.get('to');
  if (from && to) {
    const spanDays = (Date.parse(to) - Date.parse(from)) / 864e5;
    return spanDays > 32 ? yearOpt(Number(to.slice(0, 4))) : monthOpt(to.slice(0, 7));
  }
  return DEFAULT_RANGE;
}

// Two clean dropdowns: by month (most recent 12 with data) and by year (only years
// with data). Picking one switches the active period; the other shows a placeholder.
// Auto-selects the most recent month on first load.
export default function RangePicker({ value, onChange }: { value: string; onChange: (r: RangeOpt) => void }) {
  const [months, setMonths] = useState<RangeOpt[]>([]);
  const [years, setYears] = useState<number[]>([]);
  useEffect(() => {
    api<{ months: string[]; years: number[] }>('/api/tx-months').then(r => {
      const opts = (r.months || []).map(monthOpt);
      setMonths(opts);
      setYears(r.years || []);
      // Nothing valid selected yet (the transient default, or a carried period with
      // no data): snap to the most recent month.
      if (opts.length && !opts.some(o => o.value === value)) onChange(opts[0]);
    }).catch(() => {});
  }, []);
  // The year dropdown also hosts the "All time" choice (value 'all').
  const isYear = value === 'all' || value[0] === 'y';
  const knownMonth = months.some(m => m.value === value);
  return (
    <>
      <select className="rangepick" value={knownMonth ? value : '_m'} disabled={!months.length}
        onChange={e => { const r = months.find(x => x.value === e.target.value); if (r) onChange(r); }}>
        <option value="_m" disabled hidden>{months.length ? 'By month…' : 'No data yet'}</option>
        {months.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>
      <select className="rangepick" value={isYear ? value : '_y'} disabled={!years.length}
        onChange={e => {
          const v = e.target.value;
          if (v === 'all') { onChange(allTimeOpt(years)); return; }
          const y = Number(v.slice(1)); if (y) onChange(yearOpt(y));
        }}>
        <option value="_y" disabled hidden>{years.length ? 'By year…' : 'No year data'}</option>
        <option value="all">All time</option>
        {years.map(y => <option key={y} value={`y${y}`}>{y}</option>)}
      </select>
    </>
  );
}

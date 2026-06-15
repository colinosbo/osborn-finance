import { useEffect, useState, useCallback, useMemo, Fragment } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmt, color } from '../api';
import type { Toast } from '../App';
import EmptyState from '../EmptyState';
import RangePicker, { rangeFromParams, applyRange, type RangeOpt } from '../RangePicker';

interface Tx { id: string; date: string; name: string; merchant: string; amount: number; balance: number | null; category: string; }
interface Group { merchant: string; category: string; count: number; total: number; rows: Tx[] }

export default function Ledger({ toast }: { toast: Toast }) {
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Tx[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState(params.get('cat') || '');
  const [range, setRange] = useState<RangeOpt>(() => rangeFromParams(params));
  const [flow, setFlow] = useState(params.get('flow') || '');
  const [q, setQ] = useState(params.get('q') || '');
  const [editing, setEditing] = useState<string | null>(null);
  const [grouped, setGrouped] = useState(true);
  const [allRows, setAllRows] = useState<Tx[]>([]);
  // `open` = which merchant group is expanded; arriving with ?open=<merchant> from a
  // top-merchant click lands on the full grouped list with that group already open.
  const [open, setOpen] = useState<string | null>(params.get('open'));
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [hasBank, setHasBank] = useState(false);
  const LIMIT = 25;

  // paginated list (list mode)
  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(page * LIMIT) });
    applyRange(p, range);
    if (cat) p.set('cat', cat); if (flow) p.set('flow', flow); if (q) p.set('q', q);
    api<{ rows: Tx[]; total: number }>(`/api/transactions?${p}`).then(r => { setRows(r.rows); setTotal(r.total); });
  }, [page, cat, flow, q, range]);
  // full pull for grouping (grouped mode)
  const loadAll = useCallback(() => {
    const p = new URLSearchParams({ limit: '200' });
    applyRange(p, range);
    if (cat) p.set('cat', cat); if (flow) p.set('flow', flow); if (q) p.set('q', q);
    api<{ rows: Tx[] }>(`/api/transactions?${p}`).then(r => setAllRows(r.rows));
  }, [cat, flow, q, range]);

  useEffect(() => { if (grouped) loadAll(); else load(); }, [grouped, load, loadAll]);
  useEffect(() => { api<string[]>('/api/categories').then(setCats); }, []);
  // detect whether the account has any transactions at all (unfiltered),
  // and whether a bank is connected (so we can tell "no bank" from "still syncing").
  useEffect(() => {
    api<{ total: number }>('/api/transactions?limit=1').then(r => setHasData(r.total > 0)).catch(() => setHasData(false));
    api<{ items: unknown[]; accounts: unknown[] }>('/api/accounts').then(r => setHasBank((r.items?.length || 0) > 0 || (r.accounts?.length || 0) > 0)).catch(() => {});
  }, []);

  const groups = useMemo<Group[]>(() => {
    const g: Record<string, Group> = {};
    for (const t of allRows) {
      const k = t.merchant || t.name;
      (g[k] ||= { merchant: k, category: t.category, count: 0, total: 0, rows: [] });
      g[k].count++; g[k].total += t.amount; g[k].rows.push(t);
    }
    return Object.values(g).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
  }, [allRows]);

  const recat = async (merchant: string, newCat: string) => {
    const r = await api<{ updated: number }>('/api/transactions/recategorize', { method: 'POST', body: { merchant, category: newCat } });
    toast(`${r.updated} "${merchant}" transaction(s) → ${newCat}`);
    setEditing(null); grouped ? loadAll() : load();
  };

  const reclassify = async () => {
    try {
      const r = await api<{ updated: number; total: number }>('/api/transactions/reclassify', { method: 'POST' });
      toast(`Re-categorized ${r.updated} of ${r.total} transactions`);
      grouped ? loadAll() : load();
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <div className="sec-head"><span className="sec-num">03</span><span className="sec-title">Ledger</span></div>
      <div className="sec-sub">Every transaction. Group by merchant to total repeats, or click a category to reassign it</div>
      {hasData === false ? (
        hasBank ? (
          <EmptyState
            icon="ledger"
            eyebrow="Ledger"
            title="Your accounts are connected"
            sub="Transactions are still importing from your bank, this can take a moment right after linking. Head to Accounts and tap Sync now, then check back here."
            cta={{ to: '/accounts', label: 'Go to Accounts' }}
            secondary={null}
          />
        ) : (
          <EmptyState
            icon="ledger"
            eyebrow="Ledger"
            title="No transactions yet"
            sub="Connect a bank or import a CSV, and every transaction lands here, automatically categorized and groupable by merchant so repeats like Starbucks total up together."
          />
        )
      ) : (
      <div className="panel">
        <div className="controls">
          <RangePicker value={range.value} onChange={r => { setRange(r); setPage(0); }} />
        </div>
        <div className="controls">
          <div className="seg">
            <button className={'seg-btn' + (!grouped ? ' active' : '')} onClick={() => setGrouped(false)}>List</button>
            <button className={'seg-btn' + (grouped ? ' active' : '')} onClick={() => { setGrouped(true); setOpen(null); }}>Grouped</button>
          </div>
          <select value={cat} onChange={e => { setCat(e.target.value); setPage(0); }}>
            <option value="">All categories</option>
            {cats.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={flow} onChange={e => { setFlow(e.target.value); setPage(0); }}>
            <option value="">Money in & out</option><option value="out">Spending only</option><option value="in">Income only</option>
          </select>
          <input style={{ flex: 1, minWidth: 160 }} placeholder="Search transactions" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
          <button className="btn" onClick={reclassify} title="Re-apply the latest category rules to all your transactions">↻ Re-categorize all</button>
        </div>

        {grouped ? (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th style={{ width: 18 }}></th><th>Merchant</th><th>Category</th><th className="amt">Count</th><th className="amt">Total</th></tr></thead>
              <tbody>
                {groups.map(g => (
                  <Fragment key={g.merchant}>
                    <tr className="grp-row" onClick={() => setOpen(open === g.merchant ? null : g.merchant)}>
                      <td><span className={'chev' + (open === g.merchant ? ' open' : '')}>›</span></td>
                      <td style={{ fontWeight: 650 }}>{g.merchant}</td>
                      <td><span className="tag" onClick={e => { e.stopPropagation(); setEditing(g.merchant); }} title="Click to recategorize all"><i style={{ background: color(g.category) }} />{g.category}</span>
                        {editing === g.merchant && <select autoFocus defaultValue={g.category} onClick={e => e.stopPropagation()} onChange={e => recat(g.merchant, e.target.value)} onBlur={() => setEditing(null)} style={{ marginLeft: 8 }}>{cats.map(c => <option key={c}>{c}</option>)}</select>}
                      </td>
                      <td className="amt" style={{ color: 'var(--faint)' }}>{g.count}×</td>
                      <td className="amt" style={{ fontWeight: 700, color: g.total >= 0 ? 'var(--green)' : 'var(--ink)' }}>{g.total >= 0 ? '+' : ''}{fmt(g.total)}</td>
                    </tr>
                    {open === g.merchant && g.rows.map(t => (
                      <tr className="subrow" key={t.id}>
                        <td></td>
                        <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{t.date}</td>
                        <td style={{ color: 'var(--muted)' }}>{t.name}</td>
                        <td className="amt"></td>
                        <td className="amt" style={{ color: t.amount >= 0 ? 'var(--green)' : 'var(--muted)' }}>{t.amount >= 0 ? '+' : ''}{fmt(t.amount)}</td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                {!groups.length && <tr><td colSpan={5} className="empty">No transactions match these filters.</td></tr>}
              </tbody>
            </table>
            <div className="controls" style={{ marginTop: 16, marginBottom: 0, justifyContent: 'center' }}>
              <span style={{ color: 'var(--faint)', fontSize: 12 }}>{groups.length} merchants · {allRows.length} transactions (most recent 200)</span>
            </div>
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Date</th><th>Description</th><th>Category</th><th className="amt">Amount</th><th className="amt">Balance</th></tr></thead>
                <tbody>
                  {rows.map(t => (
                    <tr key={t.id}>
                      <td style={{ whiteSpace: 'nowrap', color: 'var(--muted)' }}>{t.date}</td>
                      <td>{t.name}</td>
                      <td>
                        {editing === t.id
                          ? <select autoFocus defaultValue={t.category} onChange={e => recat(t.merchant, e.target.value)} onBlur={() => setEditing(null)}>{cats.map(c => <option key={c}>{c}</option>)}</select>
                          : <span className="tag" onClick={() => setEditing(t.id)} title="Click to recategorize"><i style={{ background: color(t.category) }} />{t.category}</span>}
                      </td>
                      <td className="amt" style={{ fontWeight: 650, color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)' }}>{t.amount >= 0 ? '+' : ''}{fmt(t.amount)}</td>
                      <td className="amt" style={{ color: 'var(--faint)' }}>{t.balance != null ? fmt(t.balance) : '·'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="controls" style={{ marginTop: 16, justifyContent: 'center' }}>
              <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ alignSelf: 'center', color: 'var(--faint)', fontSize: 12 }}>{total ? page * LIMIT + 1 : 0}–{Math.min((page + 1) * LIMIT, total)} of {total}</span>
              <button className="btn" disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </>
        )}
      </div>
      )}
    </>
  );
}

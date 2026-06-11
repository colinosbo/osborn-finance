import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, fmt, color } from '../api';
import type { Toast } from '../App';

interface Tx { id: string; date: string; name: string; merchant: string; amount: number; balance: number | null; category: string; }

export default function Ledger({ toast }: { toast: Toast }) {
  const [params] = useSearchParams();
  const [rows, setRows] = useState<Tx[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [cats, setCats] = useState<string[]>([]);
  const [cat, setCat] = useState('');
  const [flow, setFlow] = useState(params.get('flow') || '');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const LIMIT = 25;

  const load = useCallback(() => {
    const p = new URLSearchParams({ limit: String(LIMIT), offset: String(page * LIMIT) });
    if (cat) p.set('cat', cat); if (flow) p.set('flow', flow); if (q) p.set('q', q);
    api<{ rows: Tx[]; total: number }>(`/api/transactions?${p}`).then(r => { setRows(r.rows); setTotal(r.total); });
  }, [page, cat, flow, q]);
  useEffect(load, [load]);
  useEffect(() => { api<string[]>('/api/categories').then(setCats); }, []);

  const recat = async (t: Tx, newCat: string) => {
    const r = await api<{ updated: number }>('/api/transactions/recategorize', { method: 'POST', body: { merchant: t.merchant, category: newCat } });
    toast(`${r.updated} "${t.merchant}" transaction(s) → ${newCat}`);
    setEditing(null); load();
  };

  return (
    <>
      <div className="sec-head"><span className="sec-num">03</span><span className="sec-title">Ledger</span></div>
      <div className="sec-sub">Every transaction — click a category tag to reassign it</div>
      <div className="panel">
        <div className="controls">
          <select value={cat} onChange={e => { setCat(e.target.value); setPage(0); }}>
            <option value="">All categories</option>
            {cats.map(c => <option key={c}>{c}</option>)}
          </select>
          <select value={flow} onChange={e => { setFlow(e.target.value); setPage(0); }}>
            <option value="">Money in & out</option><option value="out">Spending only</option><option value="in">Income only</option>
          </select>
          <input style={{ flex: 1, minWidth: 200 }} placeholder="Search transactions" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} />
        </div>
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
                      ? <select autoFocus defaultValue={t.category} onChange={e => recat(t, e.target.value)} onBlur={() => setEditing(null)}>{cats.map(c => <option key={c}>{c}</option>)}</select>
                      : <span className="tag" onClick={() => setEditing(t.id)} title="Click to recategorize"><i style={{ background: color(t.category) }} />{t.category}</span>}
                  </td>
                  <td className="amt" style={{ fontWeight: 650, color: t.amount >= 0 ? 'var(--green)' : 'var(--ink)' }}>{t.amount >= 0 ? '+' : ''}{fmt(t.amount)}</td>
                  <td className="amt" style={{ color: 'var(--faint)' }}>{t.balance != null ? fmt(t.balance) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="controls" style={{ marginTop: 16, justifyContent: 'center' }}>
          <button className="btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
          <span style={{ alignSelf: 'center', color: 'var(--faint)', fontSize: 12 }}>{page * LIMIT + 1}–{Math.min((page + 1) * LIMIT, total)} of {total}</span>
          <button className="btn" disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
        </div>
      </div>
    </>
  );
}

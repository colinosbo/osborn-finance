import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import type { Toast } from '../App';

interface Me { plan: string; items: { id: string; institution: string; status: string }[]; }

export default function Accounts({ toast }: { toast: Toast }) {
  const [me, setMe] = useState<Me | null>(null);
  const load = useCallback(() => { api<Me>('/api/me').then(setMe); }, []);
  useEffect(load, [load]);

  const connect = async () => {
    try {
      const lt = await api<{ link_token: string; mock: boolean }>('/api/plaid/link-token', { method: 'POST' });
      if (lt.mock) {
        // mock mode: skip Plaid Link UI, exchange a fake public token directly
        const r = await api<{ item: { institution: string }; imported: number }>('/api/plaid/exchange', { method: 'POST', body: { public_token: 'public-mock-' + Date.now() } });
        toast(`${r.item.institution} connected · ${r.imported} transactions imported`);
      } else {
        // production: open Plaid Link with lt.link_token (react-plaid-link), then POST /api/plaid/exchange
        toast('Open Plaid Link with the returned token (production wiring)');
      }
      load();
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 402) toast(err.message); else toast('Error: ' + err.message);
    }
  };
  const sync = async () => {
    const r = await api<{ imported: number }>('/api/plaid/sync', { method: 'POST' });
    toast(`Sync complete · ${r.imported} new transactions`);
  };
  const unlink = async (id: string) => {
    await api(`/api/plaid/items/${id}`, { method: 'DELETE' });
    toast('Bank disconnected'); load();
  };
  const importCSV = async (f: File) => {
    const text = await f.text();
    try {
      const r = await api<{ imported: number; skipped: number; duplicates: number }>('/api/import/csv', { method: 'POST', raw: text });
      toast(`${r.imported} imported · ${r.skipped} skipped · ${r.duplicates} duplicates ignored`);
    } catch (e) { toast('Import failed: ' + (e as Error).message); }
  };

  return (
    <>
      <div className="sec-head"><span className="sec-num">02</span><span className="sec-title">Accounts</span></div>
      <div className="sec-sub">Connected banks and data sources · plan: <b>{me?.plan || '…'}</b></div>
      <div className="row2">
        <div className="panel">
          <h3>Bank connections</h3><div className="psub">Via Plaid — your credentials never touch our servers</div>
          {!me?.items.length && <div className="empty">No banks connected yet</div>}
          {me?.items.map(i => (
            <div className="lrow" key={i.id}>
              <span className="name">🏦 {i.institution}</span>
              <span style={{ fontSize: 11, color: i.status === 'healthy' ? 'var(--green)' : 'var(--red)' }}>{i.status}</span>
              <button className="btn danger" onClick={() => unlink(i.id)}>Unlink</button>
            </div>
          ))}
          <div className="controls" style={{ marginTop: 18 }}>
            <button className="btn primary" onClick={connect}>+ Connect a bank</button>
            {!!me?.items.length && <button className="btn" onClick={sync}>↻ Sync now</button>}
          </div>
        </div>
        <div className="panel">
          <h3>CSV import</h3><div className="psub">Fallback for any account — same engine as the free tier</div>
          <input type="file" accept=".csv,.txt" onChange={e => e.target.files?.[0] && importCSV(e.target.files[0])} style={{ padding: 8, height: 'auto' }} />
        </div>
      </div>
    </>
  );
}

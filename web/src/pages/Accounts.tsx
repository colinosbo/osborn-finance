import { useEffect, useState, useCallback } from 'react';
import { usePlaidLink } from 'react-plaid-link';
import { api, fmt, planLabel } from '../api';
import type { Toast } from '../App';

interface Item { id: string; institution_name?: string; institution?: string; status: string; }
interface Account { id: string; item_id: string; name: string; mask: string; type: string; current_balance: number; }
interface AcctResp { items: Item[]; accounts: Account[]; }

// Opens Plaid Link as soon as it's ready, then hands the public_token back.
// In sandbox, log in with username `user_good` / password `pass_good`.
function LinkLauncher({ token, onDone }: { token: string; onDone: (publicToken: string | null) => void }) {
  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (public_token: string) => onDone(public_token),
    onExit: () => onDone(null)
  });
  useEffect(() => { if (ready) open(); }, [ready, open]);
  return null;
}

const ACCT_ICON: Record<string, string> = {
  checking: '🟢', depository: '🟢', savings: '🔵', credit: '🟣', loan: '🟠', investment: '🟡', brokerage: '🟡'
};
const acctIcon = (t: string) => ACCT_ICON[t?.toLowerCase()] || '⚪';

export default function Accounts({ toast }: { toast: Toast }) {
  const [plan, setPlan] = useState<string>('…');
  const [data, setData] = useState<AcctResp>({ items: [], accounts: [] });
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<{ plan: string }>('/api/me').then(m => setPlan(m.plan)).catch(() => {});
    api<AcctResp>('/api/accounts').then(setData).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const exchange = async (publicToken: string) => {
    setBusy(true);
    try {
      const r = await api<{ item: { institution: string }; imported: number }>('/api/plaid/exchange', { method: 'POST', body: { public_token: publicToken } });
      toast(`${r.item.institution} connected · ${r.imported} transactions imported`);
      load();
    } catch (e) { toast('Error: ' + (e as Error).message); } finally { setBusy(false); }
  };
  const connect = async () => {
    try {
      const lt = await api<{ link_token: string; mock: boolean }>('/api/plaid/link-token', { method: 'POST' });
      if (lt.mock) await exchange('public-mock-' + Date.now()); else setLinkToken(lt.link_token);
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 402) toast(err.message); else toast('Error: ' + err.message);
    }
  };
  const onLinkDone = (publicToken: string | null) => {
    setLinkToken(null);
    if (publicToken) exchange(publicToken);
  };
  const sync = async () => {
    setBusy(true);
    try { const r = await api<{ imported: number }>('/api/plaid/sync', { method: 'POST' }); toast(`Sync complete · ${r.imported} new transactions`); load(); }
    finally { setBusy(false); }
  };
  const unlink = async (id: string) => {
    if (!confirm('Disconnect this bank? Its accounts and transactions will be removed.')) return;
    await api(`/api/plaid/items/${id}`, { method: 'DELETE' });
    toast('Bank disconnected'); load();
  };
  const importCSV = async (f: File) => {
    const text = await f.text();
    try {
      const r = await api<{ imported: number; skipped: number; duplicates: number }>('/api/import/csv', { method: 'POST', raw: text });
      toast(`${r.imported} imported · ${r.skipped} skipped · ${r.duplicates} duplicates ignored`);
      load();
    } catch (e) { toast('Import failed: ' + (e as Error).message); }
  };

  const instName = (it: Item) => it.institution_name || it.institution || 'Connected Bank';
  const acctsFor = (itemId: string) => data.accounts.filter(a => a.item_id === itemId);
  const netWorth = data.accounts.reduce((s, a) => s + (a.current_balance || 0), 0);
  const totalAccounts = data.accounts.length;

  return (
    <>
      {linkToken && <LinkLauncher token={linkToken} onDone={onLinkDone} />}
      <div className="sec-head"><span className="sec-num">02</span><span className="sec-title">Accounts</span></div>
      <div className="sec-sub">Connected banks &amp; balances · plan: <b>{planLabel(plan)}</b></div>

      {/* summary strip */}
      <div className="cards acct-summary" style={{ marginBottom: 28 }}>
        <div className="card"><div className="label">Net balance</div><div className="value">{fmt(netWorth)}</div><div className="detail">{totalAccounts} account{totalAccounts === 1 ? '' : 's'} across {data.items.length} bank{data.items.length === 1 ? '' : 's'}</div></div>
        <div className="card"><div className="label">Linked banks</div><div className="value">{data.items.length}</div><div className="detail">{data.items.filter(i => i.status === 'healthy').length} healthy</div></div>
        <div className="card"><div className="label">Accounts</div><div className="value">{totalAccounts}</div><div className="detail">checking · savings · more</div></div>
        <div className="card connect-card" onClick={busy ? undefined : connect} role="button" tabIndex={0}
          onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy) connect(); }}>
          <div className="label">Add</div><div className="value plus">＋</div><div className="detail">{busy ? 'Working…' : 'Connect a bank'}</div>
        </div>
      </div>

      <div className="row2">
        <div className="panel">
          <h3>Bank connections</h3>
          <div className="psub">Via Plaid — your credentials never touch our servers</div>

          {!data.items.length && (
            <div className="empty-state">
              <div className="es-ico">🏦</div>
              <div className="es-title">No banks connected yet</div>
              <div className="es-sub">Connect an account to import balances and transactions automatically.</div>
              <button className="btn primary" onClick={connect} disabled={busy}>{busy ? 'Working…' : '+ Connect a bank'}</button>
            </div>
          )}

          {data.items.map((it, idx) => {
            const accts = acctsFor(it.id);
            return (
              <div className="bank-block" key={it.id} style={{ animationDelay: `${idx * 60}ms` }}>
                <div className="bank-head">
                  <div className="bank-id">
                    <span className="bank-logo">{instName(it).slice(0, 2).toUpperCase()}</span>
                    <div>
                      <div className="bank-name">{instName(it)}</div>
                      <div className={'bank-status ' + (it.status === 'healthy' ? 'ok' : 'warn')}>
                        <span className={'statusdot ' + (it.status === 'healthy' ? 'on' : 'off')} />{it.status === 'healthy' ? 'Connected' : it.status.replace('_', ' ')}
                      </div>
                    </div>
                  </div>
                  <button className="iconbtn danger" title="Disconnect" onClick={() => unlink(it.id)}>Unlink</button>
                </div>
                {accts.length ? accts.map((a, j) => (
                  <div className="acct-row" key={a.id} style={{ animationDelay: `${idx * 60 + j * 45 + 60}ms` }}>
                    <span className="acct-ico">{acctIcon(a.type)}</span>
                    <div className="acct-meta">
                      <span className="acct-name">{a.name}</span>
                      <span className="acct-sub">{a.type}{a.mask ? ` ··${a.mask}` : ''}</span>
                    </div>
                    <span className={'acct-bal' + ((a.current_balance || 0) < 0 ? ' neg' : '')}>{fmt(a.current_balance || 0)}</span>
                  </div>
                )) : <div className="acct-row muted"><span className="acct-ico">⏳</span><div className="acct-meta"><span className="acct-name">Syncing accounts…</span><span className="acct-sub">Hit “Sync now” if this persists</span></div></div>}
              </div>
            );
          })}

          {!!data.items.length && (
            <div className="controls" style={{ marginTop: 18, marginBottom: 0 }}>
              <button className="btn primary" onClick={connect} disabled={busy}>+ Connect another bank</button>
              <button className="btn" onClick={sync} disabled={busy}>{busy ? '↻ Syncing…' : '↻ Sync now'}</button>
            </div>
          )}
        </div>

        <div className="panel">
          <h3>CSV import</h3>
          <div className="psub">Fallback for any account or institution we cannot auto-connect</div>
          <label className="dropzone">
            <input type="file" accept=".csv,.txt" hidden onChange={e => e.target.files?.[0] && importCSV(e.target.files[0])} />
            <span className="dz-ico">⤓</span>
            <span className="dz-title">Drop a CSV or click to choose</span>
            <span className="dz-sub">Bank or card statement export</span>
          </label>
        </div>
      </div>
    </>
  );
}

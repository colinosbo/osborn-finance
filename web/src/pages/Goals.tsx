import { useEffect, useState } from 'react';
import { api, fmt, fmt0, fmtDate } from '../api';
import { loadPrefs } from '../prefs';
import type { Toast } from '../App';

interface LinkedAccount { id: string; name: string; mask: string }
interface GoalView {
  id: string; name: string; target_amount: number; saved_amount: number;
  target_date: string | null; color: string; created_at: string;
  account_id: string | null; account: LinkedAccount | null;
  kind: 'savings' | 'payoff'; start_balance: number | null;
  remaining: number; pctComplete: number; monthlyNet: number;
  monthsToGoal: number | null; projectedDate: string | null;
  onTrack: boolean | null; requiredMonthly: number | null;
  status: 'reached' | 'on_track' | 'behind' | 'stalled' | 'no_target';
}
interface Resp { goals: GoalView[]; totals: { count: number; saved: number; target: number; monthlyNet: number } }
interface Account { id: string; name: string; mask: string; type: string; current_balance: number }

// A credit/loan account is debt to pay down, not money saved.
const isLiability = (t?: string) => /credit|loan|mortgage|student|line of credit/i.test(t || '');

const COLORS = ['#7c3aed', '#188d49', '#1c7ed6', '#e8590c', '#d6336c', '#0ca678', '#f08c00'];

// One-tap starting points so a new goal is never a blank page.
const PRESETS: { emoji: string; name: string; amount: number; color: string }[] = [
  { emoji: '🛟', name: 'Emergency fund', amount: 5000, color: '#188d49' },
  { emoji: '🏠', name: 'House down payment', amount: 20000, color: '#7c3aed' },
  { emoji: '✈️', name: 'Vacation', amount: 2500, color: '#1c7ed6' },
  { emoji: '🚗', name: 'New car', amount: 10000, color: '#e8590c' }
];

// Pick a friendly icon from the goal's name so each card has personality.
const EMOJI_RULES: [RegExp, string][] = [
  [/house|home|down ?payment|mortgage|apartment|condo/i, '🏠'],
  [/car|truck|vehicle|auto|tesla/i, '🚗'],
  [/emergency|rainy|safety|cushion/i, '🛟'],
  [/vacation|trip|travel|holiday|flight|cruise/i, '✈️'],
  [/wedding|ring|engage|marriage/i, '💍'],
  [/baby|child|kid|nursery/i, '🍼'],
  [/school|tuition|education|college|degree|university/i, '🎓'],
  [/retire|pension|401k|nest egg/i, '🌴'],
  [/debt|loan|payoff|credit card/i, '💳'],
  [/gift|christmas|present/i, '🎁'],
  [/laptop|phone|computer|camera|console|tech|pc/i, '💻'],
  [/health|medical|surgery|dental|braces/i, '🩺'],
  [/business|startup|venture/i, '💼'],
  [/bike|cycle|motorcycle/i, '🚲'],
  [/pet|dog|cat|puppy/i, '🐾'],
  [/furniture|renovation|remodel|kitchen/i, '🛋️']
];
const goalEmoji = (name: string) => { for (const [re, e] of EMOJI_RULES) if (re.test(name)) return e; return '🎯'; };

const STATUS: Record<GoalView['status'], { label: string; cls: string }> = {
  reached: { label: 'Reached 🎉', cls: 'g-st-good' },
  on_track: { label: 'On track', cls: 'g-st-good' },
  behind: { label: 'Behind pace', cls: 'g-st-warn' },
  stalled: { label: 'No surplus yet', cls: 'g-st-mute' },
  no_target: { label: 'No deadline', cls: 'g-st-mute' }
};

function projectionText(g: GoalView, df: string): string {
  const payoff = g.kind === 'payoff';
  if (g.status === 'reached') return payoff ? 'Paid off. You are debt free, nice work.' : 'Goal reached. Nice work, time to set the next one.';
  if (g.status === 'stalled') return payoff
    ? 'No spare cash flow to put toward this debt yet. Trim expenses to start paying it down faster.'
    : 'Your recent spending leaves nothing to set aside. Trim expenses to start making progress.';
  const pace = `At about ${fmt0(g.monthlyNet)}/mo ${payoff ? 'toward it' : 'set aside'}`;
  if (g.projectedDate) {
    const eta = payoff ? `you'll be debt free around ${fmtDate(g.projectedDate, df)}` : `you'll hit this around ${fmtDate(g.projectedDate, df)}`;
    if (g.target_date && g.requiredMonthly !== null) {
      return g.onTrack
        ? `${pace}, ${eta}, ahead of your ${fmtDate(g.target_date, df)} target.`
        : `${pace}, ${eta}. To ${payoff ? 'clear it by' : 'reach'} ${fmtDate(g.target_date, df)} you'd need about ${fmt0(g.requiredMonthly)}/mo.`;
    }
    return `${pace}, ${eta}.`;
  }
  return `${pace}.`;
}

// Circular progress ring used in the overview hero.
function Ring({ pct, color, size = 150, stroke = 13 }: { pct: number; color: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, dash = (pct / 100) * c;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hairline)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${dash} ${c - dash}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .9s var(--ease)' }} />
    </svg>
  );
}

// Amount input with a leading $ so there's no ambiguity about what to type.
function Money({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="fld-money">
      <span>$</span>
      <input inputMode="decimal" placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))} />
    </div>
  );
}

function Overview({ data }: { data: Resp }) {
  const t = data.totals;
  const overallPct = t.target > 0 ? Math.min(100, Math.round(t.saved / t.target * 100)) : 0;
  const onTrack = data.goals.filter(g => g.status === 'on_track' || g.status === 'reached').length;
  const behind = data.goals.filter(g => g.status === 'behind').length;
  const reached = data.goals.filter(g => g.status === 'reached').length;
  const annual = t.monthlyNet > 0 ? t.monthlyNet * 12 : 0;
  const msg = reached === t.count && t.count > 0 ? 'Every goal reached. Time to dream a little bigger.'
    : behind > 0 ? `${behind} goal${behind > 1 ? 's' : ''} need a little more each month to stay on schedule.`
    : t.monthlyNet > 0 ? `On pace to set aside about ${fmt0(annual)} over the next year. Keep it rolling.`
    : 'Free up some monthly cash flow and these will start moving.';
  return (
    <div className="panel goal-hero">
      <div className="goal-hero-ring">
        <Ring pct={overallPct} color="var(--v600)" />
        <div className="goal-hero-ring-c"><b>{overallPct}%</b><span>overall</span></div>
      </div>
      <div className="goal-hero-body">
        <div className="goal-hero-kicker">Across all goals</div>
        <div className="goal-hero-title">{fmt0(t.saved)} <span>of {fmt0(t.target)} saved</span></div>
        <div className="goal-hero-msg">{msg}</div>
        <div className="goal-hero-stats">
          <div><b>{t.count}</b><span>goals</span></div>
          <div><b className="green">{onTrack}/{t.count}</b><span>on track</span></div>
          <div><b className={t.monthlyNet >= 0 ? 'green' : 'red'}>{fmt0(t.monthlyNet)}</b><span>spare / mo</span></div>
          <div><b>{fmt0(annual)}</b><span>est. saved / yr</span></div>
        </div>
      </div>
    </div>
  );
}

function GoalCard({ g, df, onChange, onDelete, toast }: { g: GoalView; df: string; onChange: () => void; onDelete: () => void; toast: Toast }) {
  const [adding, setAdding] = useState(false);
  const [amt, setAmt] = useState('');
  const st = STATUS[g.status];
  const emoji = goalEmoji(g.name);
  const reached = g.status === 'reached';
  const isLinked = !!g.account;
  const payoff = g.kind === 'payoff';
  const pillLabel = payoff && reached ? 'Paid off 🎉' : st.label;

  const patchSaved = async (delta: number) => {
    if (!isFinite(delta) || delta === 0) return;
    try {
      await api(`/api/goals/${g.id}`, { method: 'PATCH', body: { saved_amount: Math.max(0, g.saved_amount + delta) } });
      toast(`${delta > 0 ? 'Added' : 'Removed'} ${fmt(Math.abs(delta))} ${delta > 0 ? 'to' : 'from'} ${g.name}`);
      onChange();
    } catch (e) { toast((e as Error).message); }
  };
  const addCustom = () => { const d = parseFloat(amt); setAdding(false); setAmt(''); patchSaved(d); };

  const paceLabel = g.target_date && g.requiredMonthly != null ? 'Need / mo' : 'Spare / mo';
  const paceVal = g.target_date && g.requiredMonthly != null ? g.requiredMonthly : g.monthlyNet;

  return (
    <div className={'goal-card' + (reached ? ' done' : '')} style={{ borderTopColor: g.color }}>
      <div className="goal-top">
        <span className="goal-badge" style={{ background: g.color }}>{emoji}</span>
        <div className="goal-id">
          <div className="goal-name">{g.name}</div>
          <div className="goal-sub">{g.target_date ? `Target ${fmtDate(g.target_date, df)}` : 'No deadline set'}</div>
        </div>
        <span className={'goal-pill ' + st.cls}>{pillLabel}</span>
      </div>

      <div className="goal-figs">
        <div className="goal-pct" style={{ color: g.color }}>{g.pctComplete.toFixed(0)}<i>%</i></div>
        <div className="goal-amts"><b>{fmt(g.saved_amount)}</b><span>{payoff ? 'paid of' : 'of'} {fmt(g.target_amount)}</span></div>
      </div>

      <div className="goal-track">
        <span style={{ width: `${g.pctComplete}%`, background: g.color }} />
        {[25, 50, 75].map(m => <i key={m} className={'goal-tick' + (g.pctComplete >= m ? ' on' : '')} style={{ left: `${m}%` }} />)}
      </div>

      <div className="goal-facts">
        <div className="goal-fact"><span>{payoff ? 'Still owed' : 'Remaining'}</span><b>{fmt0(g.remaining)}</b></div>
        <div className="goal-fact"><span>{paceLabel}</span><b>{fmt0(paceVal)}</b></div>
        <div className="goal-fact"><span>{payoff ? (reached ? 'Status' : 'Debt free') : (reached ? 'Status' : 'Projected')}</span><b>{reached ? (payoff ? 'Cleared 🎉' : 'Done 🎉') : g.projectedDate ? fmtDate(g.projectedDate, df) : 'TBD'}</b></div>
      </div>

      <div className="goal-proj">{projectionText(g, df)}</div>

      {isLinked ? (
        <div className="goal-synced">
          <span className="goal-synced-dot" />
          Auto-synced from <b>{g.account!.name}{g.account!.mask ? ` ··${g.account!.mask}` : ''}</b>. {payoff ? 'Progress updates as you pay it down.' : 'Updates with the balance, no manual logging.'}
        </div>
      ) : !reached && (
        <div className="goal-quickadd">
          <span className="goal-qa-lbl">Log a contribution</span>
          <button className="goal-chip" onClick={() => patchSaved(25)}>+$25</button>
          <button className="goal-chip" onClick={() => patchSaved(50)}>+$50</button>
          <button className="goal-chip" onClick={() => patchSaved(100)}>+$100</button>
          <button className="goal-chip" onClick={() => setAdding(v => !v)}>Custom</button>
        </div>
      )}
      {adding && !isLinked && (
        <div className="goal-addrow">
          <Money value={amt} onChange={setAmt} placeholder="Amount" />
          <button className="btn primary" onClick={addCustom}>Add</button>
          <button className="btn" onClick={() => { setAdding(false); setAmt(''); }}>Cancel</button>
        </div>
      )}
      <button className="goal-del" onClick={onDelete}>Delete goal</button>
    </div>
  );
}

const EMPTY_FORM = { name: '', target: '', saved: '', date: '', color: COLORS[0], account: '' };

export default function Goals({ toast }: { toast: Toast }) {
  const df = loadPrefs().dateFormat;
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [pendingDelete, setPendingDelete] = useState<GoalView | null>(null);

  const load = () => api<Resp>('/api/goals').then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  useEffect(() => { load(); api<{ accounts: Account[] }>('/api/accounts').then(r => setAccounts(r.accounts || [])).catch(() => {}); }, []);

  const linked = !!form.account;
  const selAcct = accounts.find(a => a.id === form.account);
  const payoffMode = !!selAcct && isLiability(selAcct.type);
  const debtBal = payoffMode ? Math.max(0, selAcct!.current_balance) : 0;

  const openForm = () => { setForm({ ...EMPTY_FORM }); setShowForm(true); };
  const usePreset = (p: typeof PRESETS[number]) => setForm({ ...form, name: p.name, target: String(p.amount), color: p.color });
  // empty-state starter: open the form prefilled from a preset
  const startPreset = (p: typeof PRESETS[number]) => { setForm({ ...EMPTY_FORM, name: p.name, target: String(p.amount), color: p.color }); setShowForm(true); };

  // live preview of where the goal will start
  const savedNum = parseFloat(form.saved) || 0;
  const linkedBal = linked && !payoffMode ? Math.max(0, selAcct?.current_balance ?? 0) : 0;
  // payoff: target is the debt, and you start at 0 paid off. savings: target is what you typed.
  const targetNum = payoffMode ? debtBal : parseFloat(form.target);
  const effSaved = payoffMode ? 0 : linked ? linkedBal : savedNum;
  const previewValid = isFinite(targetNum) && targetNum > 0;
  const previewPct = previewValid ? Math.min(100, Math.round(effSaved / targetNum * 100)) : 0;
  const previewRemaining = previewValid ? Math.max(0, targetNum - effSaved) : 0;

  const create = async () => {
    if (!form.name.trim()) { toast('Give your goal a name so you can recognize it.'); return; }
    if (!previewValid) { toast(payoffMode ? 'That account has no balance to pay off.' : 'Enter how much you want to save in total.'); return; }
    if (!linked && savedNum > targetNum) { toast("Saved so far can't be more than the total target."); return; }
    try {
      await api('/api/goals', { method: 'POST', body: {
        name: form.name.trim(), target_amount: targetNum,
        saved_amount: (payoffMode || linked) ? 0 : savedNum, target_date: form.date || null, color: form.color,
        account_id: form.account || null
      } });
      toast(`Goal "${form.name.trim()}" created`);
      setForm({ ...EMPTY_FORM });
      setShowForm(false); load();
    } catch (e) { toast((e as Error).message); }
  };

  const confirmDelete = async () => {
    const g = pendingDelete; if (!g) return;
    setPendingDelete(null);
    try { await api(`/api/goals/${g.id}`, { method: 'DELETE' }); toast('Goal deleted'); load(); }
    catch (e) { toast((e as Error).message); }
  };

  const goalForm = (
    <div className="panel goal-form" style={{ marginBottom: 24 }}>
      <h3>{payoffMode ? 'Set up a debt payoff' : 'Create a savings goal'}</h3>
      <div className="psub">{payoffMode
        ? "You linked a debt account, so this goal tracks paying it down to $0. We'll handle the math."
        : "Name what you're saving for and set a total. Everything else is optional, we'll handle the math."}</div>

      <div className="goal-presets">
        <span className="goal-presets-lbl">Quick start:</span>
        {PRESETS.map(p => (
          <button key={p.name} type="button" className="goal-preset" onClick={() => usePreset(p)}>{p.emoji} {p.name}</button>
        ))}
      </div>

      <div className="goal-form-grid">
        <label className="fld goal-fld">
          <span>What are you saving for? <em className="req">required</em></span>
          <input placeholder="e.g. Emergency fund" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <small>A name you'll recognize on your dashboard.</small>
        </label>
        <label className="fld goal-fld">
          <span>{payoffMode ? 'Amount to pay off' : 'Total you want to save'} <em className="req">required</em></span>
          {payoffMode
            ? <input value={fmt(debtBal)} readOnly disabled />
            : <Money value={form.target} onChange={v => setForm({ ...form, target: v })} placeholder="5,000" />}
          <small>{payoffMode ? "The account's current balance, the debt you're clearing." : "The full amount you're aiming for."}</small>
        </label>
        <label className="fld goal-fld">
          <span>{payoffMode ? 'Paid off so far' : 'Saved so far'} <em className="opt">optional</em></span>
          {linked
            ? <input value={payoffMode ? 'Tracked as you pay it down' : 'Tracked from linked account'} readOnly disabled />
            : <Money value={form.saved} onChange={v => setForm({ ...form, saved: v })} placeholder="0" />}
          <small>{linked ? 'Pulled automatically from the linked account below.' : "Leave blank if you're starting from zero."}</small>
        </label>
        <label className="fld goal-fld">
          <span>Target date <em className="opt">optional</em></span>
          <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
          <small>Add one and we'll tell you if you're on pace.</small>
        </label>
      </div>

      <label className="fld goal-fld goal-link">
        <span>Link an account <em className="opt">optional, fully automated</em></span>
        {accounts.length > 0
          ? <select value={form.account} onChange={e => setForm({ ...form, account: e.target.value })}>
              <option value="">Track manually (you log contributions)</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.mask ? ` ··${a.mask}` : ''} {isLiability(a.type) ? `(owes ${fmt0(a.current_balance)})` : `(${fmt0(a.current_balance)})`}</option>)}
            </select>
          : <input value="No linked accounts yet" readOnly disabled />}
        <small>{accounts.length === 0
          ? 'Connect a bank on the Accounts tab to auto-track a goal from its balance.'
          : payoffMode
          ? "This is a debt account. The goal will track paying it down to $0 automatically as you make payments."
          : 'Link a savings account (like Chime) and this goal updates itself from that balance. No manual logging.'}</small>
      </label>

      <div className="goal-colorrow">
        <span className="goal-colorlbl">Color</span>
        {COLORS.map(c => <button key={c} type="button" className={'goal-swatch' + (form.color === c ? ' sel' : '')} style={{ background: c }} onClick={() => setForm({ ...form, color: c })} aria-label={'color ' + c} />)}
      </div>

      {previewValid && (
        <div className="goal-preview">
          <span className="goal-preview-dot" style={{ background: form.color }} />
          {goalEmoji(form.name)} {payoffMode
            ? <>You'll start at <b>{previewPct}%</b> paid off, with <b>{fmt(previewRemaining)}</b> still owed{form.date ? ` to clear by ${fmtDate(form.date, df)}` : ''}. Progress updates as you pay it down.</>
            : <>You'll start at <b>{previewPct}%</b>, with <b>{fmt(previewRemaining)}</b> left to save{form.date ? ` by ${fmtDate(form.date, df)}` : ''}.{linked ? ' Auto-synced from your linked account.' : ''}</>}
        </div>
      )}

      <div className="goal-actions">
        <button className="btn primary" onClick={create}>Create goal</button>
        <button className="btn" onClick={() => setShowForm(false)}>Cancel</button>
      </div>
    </div>
  );

  return (
    <>
      <div className="sec-head"><span className="sec-num">06</span><span className="sec-title">Savings <span className="grad">Goals</span></span></div>
      <div className="sec-sub">Set a target, track progress, and see when you'll get there at your current pace</div>

      {(data && data.goals.length > 0) && (
        <div className="controls" style={{ justifyContent: 'space-between' }}>
          <div style={{ fontSize: 12.5, color: 'var(--faint)' }}>
            {data.totals.monthlyNet > 0
              ? <>Projections assume about <b style={{ color: 'var(--green)' }}>{fmt0(data.totals.monthlyNet)}/mo</b> of spare cash flow.</>
              : <>Your recent net cash flow is flat or negative, so timelines can't be projected yet.</>}
          </div>
          {!showForm && <button className="btn primary" onClick={openForm}>+ New goal</button>}
        </div>
      )}

      {showForm && goalForm}

      {loading ? (
        <div className="panel"><div className="skeleton" style={{ width: '40%', marginBottom: 14 }} /><div className="skeleton" style={{ height: 70 }} /></div>
      ) : !data || data.goals.length === 0 ? (
        !showForm && (
          <div className="panel goal-empty">
            <div className="goal-empty-ico">🎯</div>
            <div className="goal-empty-title">Start your first savings goal</div>
            <div className="goal-empty-sub">Tell us a target and Osborn Finance tracks your progress, then projects when you'll get there from your real cash flow. Tap a starter to begin, or build your own.</div>
            <div className="goal-starters">
              {PRESETS.map(p => (
                <button key={p.name} type="button" className="goal-starter" onClick={() => startPreset(p)} style={{ borderTopColor: p.color }}>
                  <span className="goal-starter-emoji" style={{ background: p.color }}>{p.emoji}</span>
                  <b>{p.name}</b>
                  <span className="goal-starter-amt">{fmt0(p.amount)} target</span>
                </button>
              ))}
            </div>
            <button className="btn primary" onClick={openForm}>+ Build a custom goal</button>
          </div>
        )
      ) : (
        <>
          <Overview data={data} />
          <div className="goal-grid" style={{ marginTop: 24 }}>
            {data.goals.map(g => <GoalCard key={g.id} g={g} df={df} toast={toast} onChange={load} onDelete={() => setPendingDelete(g)} />)}
          </div>
        </>
      )}

      {pendingDelete && (
        <div className="gd-modal" role="dialog" aria-modal="true" onClick={() => setPendingDelete(null)}>
          <div className="gd-card" onClick={e => e.stopPropagation()}>
            <div className="gd-ico" style={{ background: pendingDelete.color }}>{goalEmoji(pendingDelete.name)}</div>
            <div className="gd-title">Delete this goal?</div>
            <div className="gd-sub">"{pendingDelete.name}" and its progress will be removed. This can't be undone.{pendingDelete.account ? ' Your linked account is not affected.' : ''}</div>
            <div className="gd-actions">
              <button className="btn" onClick={() => setPendingDelete(null)}>Keep it</button>
              <button className="btn danger gd-confirm" onClick={confirmDelete}>Delete goal</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

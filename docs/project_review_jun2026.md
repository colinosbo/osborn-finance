# Covisor — Project Review
**Date:** June 17, 2026 | Reviewed by: Claude

---

## 1. Live App — What I Saw

Reviewed the running app at `localhost:5173` with the Plaid sandbox bank ("Chase") connected. The app is on plan **Personal+**. Key data visible:

| Metric | Value |
|---|---|
| Net Worth | **-$53,501.32** |
| Assets | $68,473 (7 asset accounts) |
| Debts | $121,974 (mostly student/auto loans) |
| Linked Banks | 1 (Chase / Plaid sandbox) |
| Accounts | 9 |

**Account breakdown visible:**
- Plaid Checking ·0000 — $110.00
- Plaid Saving ·1111 — $210.00
- Plaid CD ·2222 — $1,000.00
- Plaid Credit Card ·3333 — **-$410.00** (credit balance, see bug #1 below)
- Plaid Money Market ·4444 — $43,200.00
- Plaid IRA ·5555 — $320.76
- Plaid 401k ·6666 — $23,631.98
- 2 more below scroll (loan accounts)

Math check: $110 + $210 + $1,000 + $43,200 + $320.76 + $23,631.98 = **$68,472.74 ≈ $68,473** ✓
Net worth: $68,473 − $121,974 = **−$53,501** ✓ (the numbers add up correctly)

---

## 2. Bugs Found

### Bug 1 — "Owed" label appears on a credit balance (Accounts page)
The Accounts page shows **"Credit Card · 3333 · Owed"** alongside a balance of **-$410.00**. In Plaid's data model, a negative credit-card balance means the bank owes YOU money (an overpayment or return credit). But the "Owed" tag is always shown for any liability-type account regardless of sign. A -$410 credit card balance should say something like "Credit balance" or show no tag, not "Owed."

**Fix:** In `Accounts.tsx`, only render the "Owed" label when `a.current_balance > 0` for liability accounts.

---

### Bug 2 — "Re-categorize all" overwrites manually-pinned transactions
In `server/src/index.ts`, the `/api/transactions/reclassify` endpoint iterates every transaction, runs `classify()`, and queues updates for any transaction whose category differs. It does **not** check the `pinned` flag. The `pinned` flag exists precisely to prevent bulk reclassification from overwriting a manual override, but the reclassify endpoint ignores it.

```ts
// CURRENT (buggy) — ignores pinned
for (const t of txs) {
  let cat = classify(t.name, t.amount);
  if (overrides[t.merchant]) cat = overrides[t.merchant];
  if (cat !== t.category) updates.push({ id: t.id, category: cat });
}

// SHOULD BE — respect the pin
if (!t.pinned && cat !== t.category) updates.push({ id: t.id, category: cat });
```

---

### Bug 3 — Grouped Ledger silently caps at 200 transactions
`Ledger.tsx` fetches only 200 rows for the grouped view (`limit: '200'`). If a user has more than 200 transactions in the selected range, merchant group totals are **incomplete** — Chase could show 60 transactions but only 30 are counted. The tiny note at the bottom ("most recent 200") is easy to miss.

**Fix options:** Increase the cap (500–1000), or add a visible banner when `allRows.length === 200` warning that totals may be partial, or paginate groups server-side.

---

### Bug 4 — Category filter dropdown doesn't refresh after "Re-categorize all"
In the Ledger, clicking **↻ Re-categorize all** calls `reclassify()` and reloads transactions — but does **not** re-fetch `/api/tx-categories`. If reclassification moved transactions into a new category, that category won't appear in the filter dropdown until a full page refresh.

**Fix:** Call `api<string[]>('/api/tx-categories').then(setUsedCats)` at the end of `reclassify()`.

---

### Bug 5 — Bank unlink doesn't clean up data in PgStore
The future plans doc already flags this: *"after unlinking a bank, that institution's data still shows in the app."*

In `MemStore`, `removeItem()` has a `// FIX:` comment that explicitly drops the linked transactions and accounts. In `PgStore`, `removeItem()` only deletes from `plaid_items`. Whether CASCADE DELETEs in the migrations handle the rest depends on the SQL schema — but even if they do, it's worth verifying. The risk is orphaned accounts and transactions surfacing in totals after a bank is disconnected.

---

### Bug 6 — Transfer detection doesn't net single-account CSV imports
`detectTransfers()` in `transfers.ts` requires BOTH legs of a transfer to have a non-empty `account` field. Single-account CSV imports (the most common import format) leave `account = null`, so no pairs qualify. The result: if someone imports one CSV for checking and one for savings separately, the "transfer to savings" outflow and the matching inflow are **not** netted, inflating both income and spending.

The code correctly documents this: *"A transfer with no identifiable second account is left counted, since we can't prove it stayed between the user's own accounts."* But this is worth calling out as an edge case users may run into.

---

### Bug 7 — `fetchReport()` early-return leaves the spinner stuck
In `Reports.tsx`:
```ts
const fetchReport = () => {
  if (!range.from) return; // ← returns without resetting setLoading(false)
  setLoading(true);
  ...
};
```
If `range.from` is ever null (can happen if a custom RangePicker implementation returns no date), the UI stays stuck showing "Refreshing" forever. Add `setLoading(false)` before the early return.

---

## 3. Data Observations (Test Bank Data)

The test data comes from Plaid's sandbox, which generates semi-randomized but realistic-looking transactions. A few things worth knowing:

- **Low liquid assets** ($110 checking, $210 savings) vs $121,974 in debt is a valid test scenario (simulates a recent grad with student loans), but may look alarming in a demo. Consider seeding the mock data with higher checking/savings if this is used for demos.
- **In-memory store** — `DATABASE_URL` is empty, so the server uses `MemStore`. Every server restart wipes all data. If you stopped and restarted the server after linking Chase, you'll need to re-link. This is the most likely reason the API shows empty data for a fresh tab — the browser has stale React state from a previous run.
- **Plaid mock mode** (`PLAID_ENV=sandbox`) uses live Plaid sandbox, not the local mock. The `cfg.plaid.mock` flag (set when `PLAID_ENV=mock`) uses hardcoded accounts (Everyday Checking $2,483, Kasasa Saver $5,120, etc.) — those are more demo-friendly numbers.

---

## 4. What's Working Well

- **Net worth math** is correct end-to-end (assets − debts, verified above)
- **Transaction classifier** has excellent coverage — 30+ regex rules, Plaid PFC category mapping, income vs refund split, money-movement exclusions all clean
- **Refund netting** and **transfer detection** logic is solid and well-documented
- **Subscription detection** is behavior-based (not a hardcoded list), so it catches new services automatically
- **Security practices** are strong: HMAC webhook verification, salted audit IP hashes, no raw provider bodies in logs, rate limiting at 300/min
- **CSV import dedup** is count-aware (allows same-day legitimate repeats), much smarter than a naive unique-constraint approach
- **Reports page** — KPIs, category breakdown with delta vs prior period, donut chart, AI insights, subscriptions, investments all render cleanly
- **"pinned" category override** system works correctly for single-transaction edits (only the bulk reclassify ignores it — see Bug 2)

---

## 5. Improvements to Add (Future Projects)

These are in rough priority order based on user impact:

### High Priority
| Item | Why it matters |
|---|---|
| **Manual transaction entry** | Cash purchases are completely invisible. A simple "Add transaction" form (date, merchant, amount, category) would cover ATM withdrawals, cash tip jars, peer payments without Venmo |
| **Budget tracker** (stub exists) | The page just says "coming soon." Per-category monthly targets with a progress bar at 80%/100% would be the #1 retention driver — users would check the app daily |
| **Pinned indicator in Ledger** | When a transaction is manually pinned, there's no visual cue. Users can't tell which categories they've overridden vs what was auto-classified |
| **Spending trend chart in Reports** | The API already returns a `trend` array (income/spend per week or month). The frontend just doesn't render it. A simple bar or line chart here would make reports significantly more useful |

### Medium Priority
| Item | Why it matters |
|---|---|
| **"Email me" report** | Button exists but shows a placeholder toast. Even a simple nodemailer/SendGrid send of the CSV would ship a complete feature |
| **Database persistence** | Set `DATABASE_URL` to a local Postgres (or SQLite via a thin adapter). Currently every restart means re-linking Plaid, which breaks any real workflow. The migration system is already built |
| **Notification/alert system** | `spendingAlerts`, `budgetAlerts`, `loginAlerts` prefs exist in `of_prefs` but nothing listens to them. Connect to an email or browser push endpoint |
| **Multi-account CSV import** | Allow the user to specify which account name a CSV belongs to (a dropdown of their linked accounts), so transfer netting works across files |
| **AI chatbot (Ask AI)** | Already planned. The advisor already builds the right context; an `/api/chat` route that passes the summary + user question to Claude Haiku would be very fast to ship |

### Lower Priority / Nice to Have
| Item | Notes |
|---|---|
| **Transaction editing** | Edit date, amount, merchant, or description on a manually added transaction |
| **Annual/YTD view in Reports** | Show all of this year at once with monthly bars, not just one 30-day period |
| **Recurring/subscription editing** | Let users mark something as "not a subscription" or add a manual subscription the detector missed |
| **Profile page** (stub) | Currently returns mock data — connect to `/api/me` properly |
| **Search across all pages** | Search is only in Ledger; a global search bar in the nav would help |
| **Dark/light mode toggle** | Theme preference (`of_theme`) exists in localStorage but there's no visible toggle in the UI |
| **Export to OFX/QFX format** | Some users import into desktop tools (Quicken, YNAB) — OFX is the universal import format |
| **Debt payoff planner visibility** | `DebtPlan` component exists in the Accounts page but may not be prominent enough |

---

## 6. Quick Wins (Can Ship This Week)

1. Fix Bug 2 (`pinned` check in reclassify) — 1 line
2. Fix Bug 4 (refresh `usedCats` after reclassify) — 1 line
3. Fix Bug 1 ("Owed" label conditional on balance sign) — 1 condition
4. Fix Bug 7 (fetchReport early-return loading state) — 1 line
5. Raise the grouped ledger cap from 200 to 1000, or add a warning banner — 5 minutes
6. Add a persistent `DATABASE_URL` pointing at a local Postgres so data survives restarts

---

## 7. Architecture Notes

The codebase is in good shape overall. The separation of concerns between `analytics.ts`, `reports.ts`, `recurring.ts`, `transfers.ts`, and `refunds.ts` is clean. The `financialsTx` helper in `index.ts` (which nets out refunds and transfers before passing data to every summary endpoint) is exactly the right pattern — it ensures all financial figures share a single consistent source of truth.

One thing to watch as you grow: the in-memory `MemStore` uses `Map<userId, Tx[]>` without any indexing. With thousands of transactions per user, every `allTx` + `detectRefunds` + `detectTransfers` + `detectRecurring` call re-scans the entire array. For now that's fine, but moving to Postgres (which you already have the migration system for) is the right call before you start onboarding real users.

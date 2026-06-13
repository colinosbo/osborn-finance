# Osborn Finance — Subscription Tracker: Requirements & Detection Plan

**Status:** Draft → implemented (Phase 1)
**Builds on:** transactions data + analytics patterns (`server/src/analytics.ts`)
**Tab:** "Subscriptions" (new top-nav entry)

---

## 1. Purpose

Automatically find the user's **recurring subscriptions and bills** from their transaction history, tell them which are **currently active**, what each costs per month and per year, and what they're spending in total — so they can spot forgotten or duplicate subscriptions and cancel them. No manual entry; it's detected from the data already synced via Plaid/CSV.

---

## 2. What the user sees (UI requirements)

- **Summary cards (top):** total **active** subscriptions count, total **monthly** recurring cost, total **annual** recurring cost, and (nice-to-have) the next charge due.
- **Active subscriptions list** — one row per detected subscription, sorted by monthly cost (biggest first), each showing:
  - Merchant name + category color/tag
  - Per-charge amount and **cadence** (Monthly / Weekly / Yearly / etc.)
  - **Monthly-equivalent** cost (so weekly/annual are comparable)
  - **Last charged** date and **next charge (estimated)** date
  - Occurrence count (e.g. "billed 6×") and a confidence indicator
- **Inactive / lapsed section** — subscriptions detected historically whose charges have stopped (likely canceled), shown separately so they don't inflate the active totals.
- **Empty state** — clear message when not enough history to detect recurring charges, with guidance to import/sync more.
- **States & polish** — loading skeleton, responsive, matches the app's dark/violet design and motion layer; respects currency/date preferences.
- **Actions (Phase 1):** read-only insight. (Future: "mark as not a subscription", reminders before a charge, cancel links.)

---

## 3. Detection plan — how we decide something is an ACTIVE subscription

Recurring charges look like: the **same merchant**, a **consistent amount**, charged on a **regular cadence**. Active = it's still happening *now*.

**Step 1 — Candidate grouping.** Take outflow transactions (amount < 0), group by merchant (fallback to cleaned name). Keep groups with **≥ 2 charges**.

**Step 2 — Consistent amount.** Compute the median charge amount for the group; keep the charges within **±15% (or ±$2)** of that median (the recurring ones). Require **≥ 2** consistent charges. The typical amount = median of those.

**Step 3 — Regular cadence.** Sort the consistent charges by date, take the gaps (days) between consecutive ones, and use the **median gap**. Map it to a known period:
  - Weekly ≈ 5–9 d · Biweekly ≈ 12–16 d · Monthly ≈ 26–35 d · Quarterly ≈ 80–100 d · Yearly ≈ 330–400 d
  Reject groups whose gaps are too irregular (gap variance too high) **unless** the category is "Subscriptions & Digital" with ≥ 3 charges (strong prior).

**Step 4 — Active vs inactive.** Using the latest date in the dataset as "now":
  - **Active** if the most recent charge is within **~1.5× the cadence period** of now (i.e. the next one is due about now or hasn't long passed).
  - **Inactive / lapsed** if the last charge is older than that (the series stopped → likely canceled).

**Step 5 — Derived fields.** For each subscription compute: cadence label, typical amount, **monthly cost** (= amount × 30.44 / period), **annual cost** (= amount × 365 / period), last charged, **next estimated charge** (= last + period), occurrence count, and a **confidence** score (more occurrences + tighter regularity = higher).

**Totals:** sum monthly and annual across **active** subscriptions; count active.

**Edge cases:** one-off purchases (1 charge) are ignored; variable bills (e.g. utilities) may show lower confidence; the category "Subscriptions & Digital" boosts confidence but detection is category-independent so it also catches gym, insurance, software billed elsewhere.

---

## 4. API & data

- **`GET /api/recurring`** → `{ subscriptions: [...], totals: { activeCount, monthlyTotal, annualTotal } }`, computed on the fly from the user's transactions (no new table needed for Phase 1). Each item: `{ merchant, category, amount, cadence, periodDays, monthlyCost, annualCost, lastCharged, nextCharge, count, active, confidence }`.
- No schema change required now. (Future: a `subscription_overrides` table to let users hide/confirm detections and set reminders.)
- Distinct from the existing `subscriptions` table, which tracks the user's **own Stripe plan** — this feature detects **their external** subscriptions from spending.

---

## 5. Phases

1. **Phase 1 (now):** detection engine + `GET /api/recurring` + read-only Subscriptions tab (active list, totals, inactive section).
2. **Phase 2:** user overrides (hide false positives, confirm), per-currency formatting, "renews in N days" badges.
3. **Phase 3:** charge-reminder notifications (ties into the reports email/SMS pipeline), price-increase detection.

---

## 6. Acceptance criteria (Phase 1)

- Visiting **Subscriptions** lists detected recurring merchants with amount, cadence, monthly-equivalent, last + next charge, and count.
- Totals reflect only **active** subscriptions; lapsed ones appear in a separate inactive section.
- Detection ignores one-off purchases and obviously irregular spend.
- Clean loading/empty states; matches app styling; numbers reconcile with the Reports "subscriptions" figure.

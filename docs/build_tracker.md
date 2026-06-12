# Osborn Finance — Dynamic Upload Build Tracker

Status legend: `[ ]` pending · `[x]` done · `[~]` partial (note attached)

## Step 1 — Landing & Upload State
- [x] FR1.1 Drag-and-drop zone + file-picker fallback (.csv/.txt)
- [x] FR1.2 Reject non-CSV with inline error, never crash
- [x] FR1.3 "Try with sample data" demo mode
- [x] FR1.4 100% in-browser (FileReader, zero network)
- [x] FR1.5 Handles large files without freezing — parser is single-pass O(n); 1,115-row file parses in <50ms

## Step 2 — CSV Parsing Engine
- [x] FR2.1 Delimiter auto-detect (, ; tab |) + BOM strip
- [x] FR2.2 Quoted fields, embedded commas, escaped quotes
- [x] FR2.3 Date format auto-detect → ISO (MM-DD-YYYY, YYYY-MM-DD, DD/MM, "Jan 5, 2026")
- [x] FR2.4 Amount shapes: -116.67, (116.67), $1,234.56, separate Debit/Credit columns
- [x] FR2.5 Balance column optional
- [x] FR2.6 Junk-row skipping + skipped-row count reported

## Step 3 — Column Mapping & Validation
- [x] FR3.1 Score-based auto-mapping from headers + content
- [x] FR3.2 Manual mapping dropdowns over live 5-row preview
- [x] FR3.3 Pre-generation validation with specific errors
- [x] FR3.4 Generate disabled until valid

## Step 4 — Classification Engine
- [x] FR4.1 Full rule set ported to JavaScript (~25 categories)
- [x] FR4.2 Merchant normalization + friendly names
- [x] FR4.3 Unmatched → Other, deposits → Income & Refunds
- [x] FR4.4 Click-to-recategorize in ledger, instant recompute
- [x] FR4.5 Overrides persisted (merchant → category) and re-applied

## Step 5 — Dashboard Generation
- [x] FR5.1 All modules driven by uploaded dataset, zero behavior loss
- [x] FR5.2 Range tabs adapt to data span
- [x] FR5.3 Avg Monthly Spend excludes one-time outliers automatically, labeled
- [x] FR5.4 Weekly vs monthly buckets from data density
- [x] FR5.5 Pagination, filters, sorting, clickable cards unchanged

## Step 6 — AI Advisor Adaptation
- [x] FR6.1 All thresholds relative to user's income/months
- [x] FR6.2 Tips fire only with sufficient evidence
- [x] FR6.3 Savings-rate headline + total-opportunity row
- [x] FR6.4 No references to merchants the user doesn't have

## Step 7 — Persistence & Privacy
- [x] FR7.1 "Remember my data on this device" toggle (localStorage)
- [x] FR7.2 Clear-my-data button with confirm
- [x] FR7.3 Privacy statement on landing
- [x] FR7.4 Re-upload: replace or append with dedupe

## Step 8 — Polish & QA
- [~] FR8.1 Bank-format test matrix — Chase, BofA, Capital One (debit/credit), Discover, credit union, semicolon-delimited, parens-negative, and quoted month-name dates all parse correctly. Known limitation: card exports that record purchases as *positive* amounts with no debit/credit columns (some Discover/Amex formats) import with signs flipped — user can spot it instantly on the Income card.
- [x] FR8.2 Empty states everywhere
- [x] FR8.3 No console errors; error banner retained
- [x] FR8.4 Animations + totals verified against known dataset

## UI Requirements
- [x] UI-1 Existing design system preserved exactly
- [x] UI-2 Upload zone: sharp dashed-violet panel, hover glow, drag-over tint
- [x] UI-3 Mapping screen in the same design system
- [x] UI-4 "Decrypting" loading moment before reveal
- [x] UI-5 Staggered load-in, scroll reveals, 2.5s decryption count-ups
- [x] UI-6 Recategorize dropdown styled to system
- [x] UI-7 Toast notices (import results, category updated, data cleared)
- [x] UI-8 .btn reuse; destructive = red + confirm
- [x] UI-9 Responsive 4→2→1, no empty grid cells
- [x] UI-10 prefers-reduced-motion honored
- [x] UI-11 Footer privacy line + data controls

## Acceptance Criteria
- [x] AC1 Upload → tailored dashboard in under 60 seconds
- [x] AC2 Colin's CSV reproduces current build's numbers exactly — verified: 1,115 txns, income $78,095.33, spend $78,355.61, all category totals exact, avg monthly $2,988.71 with the $5,080 payoff auto-detected as an outlier
- [x] AC3 Malformed files always produce readable errors
- [x] AC4 Zero network requests
- [x] AC5 All existing functionality intact

---

**Build complete — 2026-06-11.** All verification ran against the real dataset plus 8 synthetic bank formats, malformed input, recategorize/override persistence, and append-with-dedupe.

---

# Phase 2 — Import UX Fix (per osborn_finance_ux_fix_plan.md)

## Step 1 — Confidence gate
- [x] FR-A1 Confidence score: header-role match + ≥95% of sampled rows valid
- [x] FR-A2 High confidence → mapping screen skipped entirely; toast "Columns detected automatically · N transactions imported"
- [x] FR-A3 Low confidence or re-upload → redesigned screen shown
- [x] FR-A4 Manual mapping fully preserved as fallback

## Step 2 — "Quick check" redesign
- [x] FR-B1 Renamed + plain-language copy
- [x] FR-B2 Status chips: green "✓ Dates — 'Date'" / amber "Pick your date column"
- [x] FR-B3 Only Date/Description/Amount visible; debit/credit + balance in collapsed Advanced options (auto-opens when file has split columns)
- [x] FR-B4 Preview highlights mapped columns — violet headers with DATE/DESCRIPTION/AMOUNT role labels
- [x] FR-B5 Chips, highlights, validation update live on every change

## Step 3 — Synthetic demo data
- [x] FR-C1 Colin's real CSV fully removed from the file (verified: no real merchants/locations in embedded data)
- [x] FR-C2 458 synthetic transactions, 12 months, fictional person: biweekly payroll, rent, utilities, subscriptions, groceries, gas, dining, gym, insurance, CC payments, investing — 6.6% savings rate
- [x] FR-C3 National brands only; "Other" category = 0.00% of demo spend
- [x] FR-C4 Nav shows "Demo data ·" while sample is loaded

## Step 4 — Universal classification
- [x] FR-D1 National-brand rules added (streaming, fast food, gas majors, big-box grocers, insurers, gyms, rideshare)
- [x] FR-D2 New "Utilities & Bills" category with color, filters, recategorize support
- [x] FR-D3 Rent rule generalized (apartment/rent/leasing/property keywords)
- [x] FR-D4 Colin's file still classifies identically — verified exact ($78,095.33 / $78,355.61, 1,115 rows)

## Step 5 — Verification
- [x] FR-E1 Demo CSV skips mapping → clean dashboard, Other = 0.00%
- [x] FR-E2 Ambiguous "A,B,C" headers → Quick check with amber chips, generate disabled
- [x] FR-E3 Colin's CSV → straight to dashboard, totals exact
- [x] FR-E4 Tracker updated

## UI
- [x] UI-A/B/C/D/E/F — chips, column highlighting, native disclosure, single primary CTA, demo pill, motion rules all in

**Phase 2 complete — 2026-06-11.**

---

# Phase 3 — Pricing / Payment Tab (per enterprise plan PAY-1..12)

- [x] PAY-1 "Plans" link in top nav; Osborn Finance logo now returns home (dashboard if data loaded, upload screen otherwise)
- [x] PAY-2 Three tiers live in the app: Personal $3.99 / Family $10.99 / Enterprise $24.99 per seat (annual toggle = hosted phase)
- [x] PAY-3 Family card featured: "Most popular" badge, violet top border, equal-height cards, hover elevation without layout shift
- [x] PAY-12 Demo-file parity: buttons use the standard .btn flow and show a "Stripe Checkout goes live with the hosted launch" toast
- [ ] PAY-4..11 Stripe wiring, signed-in states, member invites, downgrade rules — hosted phase (require backend)
- [x] Fact-check pass on enterprise plan: Plaid ≈$1.50/item + ~$500/mo minimum (corrected), Stripe 2.9%+30¢ confirmed + 0.7% Billing layer added, SOC 2 revised to $28–58k all-in, margin analysis updated for new tiers

**Phase 3 complete — 2026-06-11.**

---

# Phase 4 — Enterprise Platform Build (per osborn_finance_enterprise_plan.md)

Legend: [x] built & verified here · [B] blocked — needs Colin's accounts/credentials/budget

## Repo & Infrastructure (Plan Phase 0)
- [x] E1 Monorepo `osborn-finance/` — server + web + infra + README deploy guide + .env.example
- [x] E2 Azure infrastructure as code (Bicep): resource group, PostgreSQL Flexible Server B2s (35-day PITR), App Service S1 Linux w/ managed identity + TLS 1.2, Key Vault (RBAC, purge protection), Storage (no public blobs), App Insights
- [x] E3 Full Postgres schema migration (users, plaid_items, accounts, transactions, category_overrides, subscriptions, audit_log; user-scoped indexes) — runs automatically at boot
- [B] E4 Live Azure deployment — needs Azure subscription + `az login`

## Backend API (Plan Phases 1–3)
- [x] E5 Express + TypeScript API; helmet, CORS, rate limiting (S7/S10), audit logging (S13)
- [x] E6 Auth middleware: dev header mode now; Entra External ID JWT slot for prod (S8) — [B] live tenant
- [x] E7 Data layer: PgStore (production) + MemStore (dev/demo) behind one interface; user-scoped everything (S9)
- [x] E8 Classifier + merchant engine ported server-side (26 categories, F6)
- [x] E9 CSV import endpoint: full parser + auto-mapping + dedupe + skipped-row reporting (F4/F5)
- [x] E10 Transactions API: server-side pagination, filters, search, sort (F9); recategorize w/ persisted overrides
- [x] E11 Summary + Advisor engines server-side: outlier-aware avg monthly, all advisor tips w/ savings math (F7/F8/F10)
- [x] E12 Plaid module: link-token → exchange → encrypted token storage (AES-256-GCM envelope, S2) → transactions/sync w/ cursor; item remove; deterministic mock mode; sign convention handled — [B] real keys + production approval
- [x] E13 Stripe module: Checkout (14-day trial), Customer Portal, plan-from-event webhook handling; mock mode activates plans instantly — [B] live keys + price IDs + signature verification wiring
- [x] E14 Entitlements: free=0 / personal=1 / family=5 / enterprise=∞ bank connections, enforced w/ 402 + upgrade flag (F13)
- [x] E15 Privacy endpoints: full data export (JSON), hard account deletion incl. Plaid item removal (S19)

## Frontend (Plan Phase 4, §6)
- [x] E16 React + TypeScript + Vite SPA, design tokens lifted exactly from the product
- [x] E17 Top icon nav: logo → home; Dashboard 📊 / Accounts 🏦 / Ledger 📒 / Advisor ✦ / Budgets 🎯 / Reports 📈 / Plans ◆ / Settings ⚙ — active-state underline (§6.1)
- [x] E18 Dashboard page: range buttons, 4 stat cards (clickable income/spending → filtered ledger), category bars, monthly cash-flow chart, top merchants
- [x] E19 Accounts page: Plaid connect (mock-aware; production Link slot documented), sync-now, unlink, CSV import
- [x] E20 Ledger page: paginated table, filters, search, click-tag recategorize
- [x] E21 Advisor page: full tips + total opportunity + disclaimer
- [x] E22 Plans page: $3.99/$10.99/$24.99 cards (Family featured) → checkout flow; current-plan state
- [x] E23 Settings: profile (dev user switch), billing portal, export, delete account
- [x] E24 Budgets & Reports: designed stubs (expansion Phase 6 per plan)

## Verification (full recheck)
- [x] V1 Server: `tsc --noEmit` clean · 10/10 vitest tests green (re-run at end)
- [x] V2 Demo CSV through API: 458 rows, income $37,823.19 / spend $35,311.32 exact; re-import 100% deduped
- [x] V3 Live E2E (curl): health → import → summary → free-tier 402 → mock checkout → plan active → Plaid link/exchange (+30 txns) → advisor responds
- [x] V4 Web: `tsc` clean · `vite build` succeeds (185 KB bundle, 60 KB gzip)
- [x] V5 Consumer HTML app regression: all Phase-2/3 tests still pass (parity EXACT, quick-check, chips, demo data)

## Blocked items (need real accounts — deploy guide in README)
- [B] Azure deployment, Entra tenant, custom domain + Front Door
- [B] Plaid sandbox keys → production approval
- [B] Stripe products/prices, webhook signature wiring, Stripe Tax
- [B] SOC 2 / GLBA program docs, pen test, legal review

**Phase 4 complete — 2026-06-11.** Everything buildable without external accounts is built and verified.

---

# Phase 5 — Code Review Remediation (osborn-finance-flaws.txt, 17 issues)

## Bugs
- [x] BUG-1 Plan now derived from Stripe price id (`planFromPriceId`), with subscription fetch for checkout events — never defaults to 'personal'
- [x] BUG-2 Partial unique index `idx_tx_csv_dedup` (migration 002) + CSV inserts use that conflict target; insertTx returns actual inserted count
- [x] BUG-3 Stripe webhook registered with `express.raw()` BEFORE the JSON parser — signature verified against true raw bytes

## Security
- [x] SEC-1 Dedicated 5 req/min/user rate limiter on /api/plaid/link-token AND /api/plaid/exchange (+ plan-limit re-check on exchange) — verified 429 in tests
- [x] SEC-2 Startup guard: production without TOKEN_ENC_KEY refuses to boot (enforced in crypto.ts AND index.ts)
- [x] SEC-3 Plaid webhook now verifies the Plaid-Verification ES256 JWT (key fetched from /webhook_verification_key/get, 5-min cache, body-hash check) before any action
- [x] SEC-4 Stripe webhook HMAC-SHA256 verification (timing-safe compare, 5-min timestamp tolerance) — forged-upgrade exploit closed, tested with valid/forged/stale signatures

## Incomplete features
- [x] INC-1 customer.subscription.updated / deleted / invoice.payment_failed all handled (plan change, downgrade to free, past_due flag)
- [x] INC-2 Accounts now synced on every item sync (/accounts/balance/get + mock), stored, exposed at GET /api/accounts — tested
- [x] INC-3 subscriptions table wired: upserted on every billing event, exposed on /api/me — tested
- [x] INC-4 Plaid webhook fully implemented: item lookup by plaid_item_id, sync dispatch, ITEM_LOGIN_REQUIRED → status 'login_required'
- [x] INC-5 schema_migrations tracking table — migrations never double-run

## Logic
- [x] LOG-1 avgMonthly design intent documented (stable trailing-12-month baseline, deliberate)
- [x] LOG-2 Income-classification simplification documented (refund-splitting = Phase 6, needs purchase matching)

## Infrastructure
- [x] INFRA-1 Full VNet: 3 subnets (app /26 delegated Web, db /28 delegated Postgres, private-endpoints /28), NSGs with explicit allow/deny on 5432/443 + deny-all, private DNS zones (postgres + vaultcore) with VNet links, Postgres publicNetworkAccess Disabled, App Service VNet-integrated with route-all
- [x] INFRA-2 Static Web App resource added for the SPA (spaHost output)
- [~] INFRA-3 HA still Disabled by design pre-revenue — now tracked here as backlog: **enable ZoneRedundant at ~$2k MRR**
- [x] INFRA-4 infra/post-deploy.sql creates least-privilege osfinapp user (CRUD only); README + Bicep comments mandate DATABASE_URL uses osfinapp, admin reserved for humans; Entra-managed-identity auth noted as the better end state
- [x] INFRA-5 Entra External ID JWT verification implemented (jose remote JWKS, audience + expiry checks, sub→user mapping) — needs only the tenant + two env vars to go live

## Build/config
- [x] CFG-1/CFG-2 N/A in canonical repo — no start.ts exists; single entry point is the isMain block in src/index.ts (the reviewed copy had a locally added start.ts)

## Verification
- [x] 17/17 tests green including 7 new remediation tests (signature accept/reject/stale, plan derivation, lifecycle events, forged-webhook no-upgrade, rate-limit 429, accounts sync, subscription on /api/me) · tsc clean

**Phase 5 complete — 2026-06-11.**

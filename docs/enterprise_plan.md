# Osborn Finance — Enterprise Implementation Plan

**From single-file dashboard to a commercial SaaS personal-finance platform.**
Version 1.1 · June 2026

---

## 1. Vision & Business Model

Osborn Finance becomes a hosted consumer web app at **osbornfinance.com**: users sign up, connect their bank with Plaid in under a minute, and get the dashboard you already have — live, always current, with AI-driven advice — for a monthly subscription billed through Stripe. The single-file app you have today becomes the **free tier and the marketing demo**; Plaid-connected, auto-syncing, multi-account intelligence is the paid product.

**End-state user journey:**

1. User lands on osbornfinance.com → marketing homepage with live interactive demo (your current synthetic-data dashboard, embedded).
2. Sign up (email + password or Google/Apple) → 14-day free trial starts.
3. "Connect your bank" → Plaid Link opens → user logs into their bank → accounts connected.
4. Transactions pull automatically (up to 24 months of history), classify server-side, dashboard renders.
5. Every night (and on webhook) new transactions sync in automatically — the user never uploads anything again.
6. Trial ends → Stripe Checkout for the paid plan; card on file, monthly auto-bill, self-service cancel.

**Suggested tiers** (assumption — adjust freely):

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | CSV upload only (today's product), local storage, demo mode |
| **Personal** | **$3.99/mo** | 1 bank connection via Plaid, daily auto-sync, full dashboard, AI Advisor, unlimited history |
| **Family** | **$10.99/mo** | Up to 5 family members, shared household dashboard + private individual views, budgets & alerts, everything in Personal |
| **Enterprise** | **$24.99/mo per seat** | For advisors & teams: multi-client workspaces, SSO/SAML, API access, white-label reports, priority support |

Margin check (post fact-check, §12): Plaid Transactions runs ≈ $1.50/connected item/mo at entry volume. Personal at $3.99 minus ~$1.50 Plaid and ~$0.45 Stripe (2.9% + 30¢ + 0.7% Billing) nets ≈ $2.00/user — workable but thin, so Personal is capped at one connection and annual prepay ($39.99/yr) should be pushed hard. Family and Enterprise carry the margin.

---

## 2. System Architecture (Azure)

```
                        ┌────────────────────────────────────────────┐
  Browser (React SPA)   │                AZURE                       │
  ───────────────────▶  │  Front Door + WAF + CDN                    │
                        │        │                                   │
                        │  App Service / Container Apps (API)        │
                        │   • Node.js or .NET REST API               │
                        │   • Auth middleware (Entra External ID)    │
                        │        │              │                    │
                        │  Azure Database for   │  Azure Functions   │
                        │  PostgreSQL Flexible  │  • Plaid webhooks  │
                        │  Server (primary DB)  │  • nightly sync    │
                        │        │              │  • Stripe webhooks │
                        │  Azure Key Vault ◀────┘  • classifier jobs │
                        │  (Plaid/Stripe secrets,                    │
                        │   per-user token encryption keys)          │
                        │                                            │
                        │  Blob Storage (CSV imports, exports,       │
                        │  report PDFs) · Service Bus (job queue)    │
                        │  Azure Monitor + Sentinel (logs/SIEM)      │
                        └────────────────────────────────────────────┘
            External: Plaid API · Stripe API · Resend/SendGrid (email)
```

**Azure service choices and why:**

- **Azure Database for PostgreSQL Flexible Server** — primary store. Relational fits transactions perfectly; row-level security per user; cheaper than Azure SQL at small scale; easy read replicas later. Start: Burstable B2s (~$30–60/mo), zone-redundant HA when revenue justifies.
- **App Service (Linux) or Container Apps** — the API. Start with one App Service plan (B1/S1), scale out horizontally. Container Apps if you want per-request scale-to-zero economics.
- **Azure Functions (Consumption)** — all async work: Plaid webhook receiver, nightly transaction sync, Stripe webhook receiver, re-classification jobs. Pay-per-execution ≈ pennies at launch.
- **Azure Front Door + WAF** — TLS, CDN for the SPA, OWASP rule set, bot protection, DDoS baseline.
- **Azure Key Vault** — Stripe secret key, Plaid client secret, JWT signing keys, and the envelope-encryption keys for Plaid access tokens. Managed identities only; no secrets in code or env files.
- **Microsoft Entra External ID (B2C)** — consumer identity: email/password, Google, Apple sign-in, MFA, password reset flows — so you never store passwords yourself.
- **Blob Storage** — CSV uploads (free tier), generated exports/reports. Lifecycle rule deletes raw uploads after 30 days.
- **Azure Monitor / App Insights / Sentinel** — APM, alerting, and security event correlation; required evidence for SOC 2 later.
- **Environments:** `dev`, `staging`, `prod` — separate resource groups and Plaid/Stripe keys (sandbox vs production). Infrastructure as code with Bicep or Terraform from day one.

---

## 3. Data Model (core tables)

- **users** — id (UUID), entra_subject_id, email, display_name, created_at, status, plan, stripe_customer_id, mfa_enabled.
- **plaid_items** — id, user_id, plaid_item_id, institution_name, institution_logo, access_token_ciphertext (envelope-encrypted; key in Key Vault), cursor (for /transactions/sync), status (healthy / login_required / revoked), consent_expires_at.
- **accounts** — id, item_id, plaid_account_id, name, mask, type (checking/savings/credit), current_balance, iso_currency.
- **transactions** — id, account_id, user_id, plaid_transaction_id (nullable for CSV rows), date, name, merchant_name, amount, pending, category_id, source (plaid | csv), created_at. Indexed on (user_id, date) and (user_id, category_id).
- **categories** — system set (the ~26 you have) + user-custom rows.
- **category_overrides** — user_id, merchant_key, category_id (your existing override feature, server-side).
- **advisor_snapshots** — cached advisor output per user per period for fast loads.
- **subscriptions** — user_id, stripe_subscription_id, plan, status, current_period_end, cancel_at.
- **audit_log** — append-only: user_id, actor, event (login, link, unlink, export, delete), ip_hash, timestamp.

Row-level security: every query is scoped by user_id at the database layer, not just the app layer.

---

## 4. Plaid Integration Plan

**Products:** `transactions` (core), `auth` optional later, `identity` optional for fraud checks. Start in **Sandbox**, then apply for **Production** access (Plaid reviews your app, privacy policy, and security posture — typically days to a few weeks).

**Connect flow:**
1. Client requests `POST /api/plaid/link-token` → server calls Plaid `link_token/create` with the user's id.
2. Client opens Plaid Link with that token; user authenticates with their bank.
3. Link returns a `public_token` → client sends to `POST /api/plaid/exchange`.
4. Server exchanges for `access_token` + `item_id`; encrypts the access token (AES-256-GCM, per-user data key wrapped by Key Vault key); stores ciphertext only.
5. Server kicks off initial sync: `transactions/sync` paginated until exhausted (up to 24 months where the institution supports it); rows normalized, classified by the rule engine (your JS classifier ported to the server, plus Plaid's own `personal_finance_category` as a second signal), inserted idempotently on plaid_transaction_id.

**Staying current:**
- Plaid webhook (`SYNC_UPDATES_AVAILABLE`) → Azure Function → enqueue sync job for that item → incremental `transactions/sync` from stored cursor.
- Nightly scheduled Function sweeps all items as a safety net.
- `ITEM_LOGIN_REQUIRED` webhook → mark item unhealthy → user sees a "Reconnect your bank" banner → update-mode Link flow.

**Functional requirements:**
- P1 Multiple items per user (Pro tier); per-account include/exclude toggle.
- P2 Pending transactions shown distinctly; replaced when posted (Plaid handles via sync removals/modifications — must process `removed` arrays).
- P3 Unlink = Plaid `item/remove` + hard-delete tokens + retain transactions only if user opts to keep history.
- P4 CSV import remains as a fallback and for accounts Plaid can't reach; dedupe between CSV and Plaid rows on (date, amount, normalized name).
- P5 Classifier precedence: user override → your rule engine → Plaid category → Other.

---

## 5. Stripe Billing Plan

- **Stripe Checkout** for initial subscription (no card forms on your servers — keeps you out of PCI scope; Stripe is the merchant of record for card data, SAQ-A).
- **Stripe Customer Portal** for self-service: change plan, update card, cancel — zero support burden.
- **Products/Prices:** `plus_monthly`, `pro_monthly` (+ annual prices at ~2 months free when ready).
- **Trials:** 14-day trial on Checkout; require card up front (higher intent) — assumption, can flip.
- **Webhooks (Azure Function):** `checkout.session.completed`, `customer.subscription.updated/deleted`, `invoice.payment_failed` → update `subscriptions` table; failed payments trigger Stripe Smart Retries + dunning emails; downgrade to Free after final failure (data retained 90 days, then deletion per policy).
- **Entitlement enforcement** in API middleware: plan → feature flags (max plaid_items, exports, budgets).
- **Tax:** Stripe Tax on from day one (US sales tax on SaaS varies by state).

---

## 6. Website Plan — Pages & Top Navigation

### 6.1 Top navigation bar (the icon row)

Persistent, sticky, frosted-glass — same design system (sharp edges, violet accents). Left → right:

| Position | Element | Behavior |
|---|---|---|
| Far left | **Osborn *Finance* logo** (gradient italic) | **Click → Home/Dashboard** from anywhere. On marketing pages → homepage. |
| Center-left | 📊 **Dashboard** | The current overview: cards, donut, cash flow, advisor summary |
| | 🏦 **Accounts** | Connected banks, balances, connect/reconnect/unlink, CSV import |
| | 📒 **Ledger** | Full transaction table: filters, search, recategorize, bulk edit, export |
| | ✦ **Advisor** | Full AI advice page: all insights, savings plan, month-over-month progress |
| | 🎯 **Budgets** | Per-category monthly budgets with progress bars + alerts (expansion) |
| | 📈 **Reports** | Monthly/annual reports, trends, category deep-dives, PDF/CSV export |
| Far right | 🔔 Notifications · ⚙ **Settings** · avatar menu (Profile, Billing, Security, Sign out) | |

Mobile: bottom tab bar with the same five core icons; hamburger for the rest. Active page = violet underline + filled icon. Every icon has a text label beneath (icon-only navs test poorly for finance products).

### 6.2 Page inventory

**Public (marketing) site**
1. **Home** — hero ("Your Finances, in the eyes of AI"), live demo embed (synthetic data), feature sections, pricing teaser, trust/security section, CTA.
2. **Pricing** — tier table, FAQ, "cancel anytime."
3. **Pricing / Plans** (the payment tab) — full spec in §6.4 below.
4. **Security** — plain-English page: encryption, Plaid (you never see credentials), data deletion. This page sells.
5. **About / Contact / Blog** (SEO engine later).
6. **Legal:** Terms of Service, Privacy Policy, (CCPA/GDPR rights page). Required by Plaid production review and Stripe.

**Authenticated app**
6. **Dashboard** — today's overview page, trimmed to highlights; every module links to its full page.
7. **Accounts** — institution cards with logos, balances, health status, "Connect another bank" (Plaid Link), CSV import zone, per-account visibility toggles.
8. **Ledger** — full-page version of the current table; adds bulk recategorize, notes, receipt attach (later), server-side pagination for 100k+ rows.
9. **Advisor** — all insights with history ("you cut dining 14% since March"), action checklists, monthly savings target tracking.
10. **Budgets** — set per-category budgets; progress bars; email/push alerts at 80%/100%.
11. **Reports** — month/quarter/year summaries; downloadable PDF (server-rendered) and CSV.
12. **Settings → Profile** — name, email, password/MFA (delegated to Entra).
13. **Settings → Billing** — plan, invoices, Stripe Customer Portal link.
14. **Settings → Security & Data** — active sessions, connected apps, **Export all my data** (JSON/CSV), **Delete my account** (full purge incl. Plaid item removal — legally required).
15. **Onboarding wizard** — first-login: connect bank → first sync progress (decryption animation!) → quick tour.
16. **System pages** — 404, maintenance, email-verification, reconnect-bank interstitial.

### 6.3 Pricing / Plans page — "the payment tab"

A dedicated **Plans** page reachable from the top nav (and footer), shown to both visitors and signed-in users (signed-in users see their current plan badged and the buttons become upgrade/downgrade actions through Stripe).

**Layout** — same design system: sharp edges, violet accents, eyebrow label ("PRICING — SIMPLE, CANCEL ANYTIME"), section number, three pricing cards in a row (stack on mobile):

- **Personal — $3.99/mo.** "Your money, decrypted." One bank connection, daily auto-sync, the full dashboard, AI Advisor, unlimited history.
- **Family — $10.99/mo** *(center card, "Most popular" badge, violet top border, slight elevation)*. "One household, every account." Up to 5 members, shared household view plus private individual dashboards, budgets and alerts.
- **Enterprise — $24.99/mo per seat.** "For advisors and teams." Multi-client workspaces, SSO, API access, white-label reports, priority support.

Each card: tier name, gradient-italic price, one-line description, 5–6 feature checkmarks, and a full-width `.btn` ("Start Personal", primary violet on the featured card). Under the grid: "Every plan starts with a 14-day free trial · No card games — cancel in two clicks" and a link to the Security page.

**Button flow:** visitor → button opens sign-up, then Stripe Checkout pre-loaded with that price ID; signed-in Free user → straight to Checkout; signed-in paid user → Stripe Customer Portal for plan changes. Identical hover/press motion to every other button in the product.

**Payment-tab requirements**

- PAY-1 Plans page in top nav and footer; logo still returns home.
- PAY-2 Three tiers at $3.99 / $10.99 / $24.99 monthly; annual prices (2 months free) as a billing toggle.
- PAY-3 Featured-card treatment for Family (badge, violet top border); all cards same height, no layout shift on hover.
- PAY-4 Buttons wire to Stripe Checkout with the correct `price_id`; one click from card to payment.
- PAY-5 Signed-in users see "Current plan" state and Portal-driven upgrade/downgrade/cancel.
- PAY-6 Trial messaging and cancel-anytime copy adjacent to every buy button (FTC dark-pattern rules: clear, symmetrical cancel path).
- PAY-7 Prices rendered from a single config (synced with Stripe Prices via API) — never hardcoded in two places.
- PAY-8 Tax-inclusive display handled by Stripe Tax where required.
- PAY-9 Enterprise card includes a "Talk to us" secondary link (sales email) alongside self-serve checkout.
- PAY-10 Family plan member-invite flow (email invites, owner manages seats) — required before Family tier can ship.
- PAY-11 Downgrade rules defined: Family→Personal keeps owner data, members get export window; Enterprise seat removal prorated.
- PAY-12 Static demo file gets the same Plans view with buttons showing a "checkout arrives with the hosted launch" notice — design parity now, wiring later.

### 6.4 Frontend stack

Rebuild the SPA in **React + TypeScript + Vite** (Tailwind tokens lifted from your current design system — preserve the look exactly). Component library = your existing panels/cards/chips/charts componentized. Charting stays hand-rolled SVG (zero-dependency, already proven). State: TanStack Query against the REST API. Hosted as static assets behind Front Door; API on `/api/*`.

---

## 7. Security Requirements (non-negotiable list)

**Data protection**
- S1 TLS 1.2+ everywhere; HSTS; TLS termination at Front Door.
- S2 Encryption at rest: PostgreSQL + Blob (Azure default) **plus** application-layer envelope encryption for Plaid access tokens (AES-256-GCM, keys in Key Vault, rotated annually).
- S3 No bank credentials ever touch your systems (Plaid Link handles them) — say this loudly in marketing.
- S4 Card data never touches your systems (Stripe Checkout) — keeps PCI scope at SAQ-A.
- S5 Secrets only in Key Vault; access via managed identities; no secrets in code, CI, or logs.
- S6 PII minimization: store only what features need; no SSNs, no full account numbers (mask only).

**Application security**
- S7 OWASP Top 10 baseline: parameterized queries, output encoding, CSRF tokens, strict CSP, dependency scanning (Dependabot/Snyk) in CI.
- S8 AuthN via Entra External ID (OIDC); short-lived JWTs (15 min) + rotating refresh tokens; MFA available to all users, required for email/password accounts on sensitive actions.
- S9 AuthZ: every API route enforces user-scoping; row-level security in Postgres as the second wall.
- S10 Rate limiting + bot rules at Front Door WAF; account-lockout and credential-stuffing protection via Entra.
- S11 Webhook authenticity: verify Plaid webhook JWT and Stripe signature on every event.
- S12 Input validation server-side for everything (CSV parser runs in an isolated job, size-capped).

**Operations & compliance**
- S13 Audit log (append-only) for auth events, link/unlink, exports, deletions, admin actions.
- S14 Backups: PostgreSQL PITR (35-day window) + weekly long-term snapshots; quarterly restore drills.
- S15 DR: zone-redundant HA at revenue; documented RTO 4h / RPO 1h targets.
- S16 Monitoring/alerting: failed-login spikes, webhook failures, sync error rates, p95 latency.
- S17 Pen test before public launch; annual thereafter; bug-bounty disclosure page.
- S18 Compliance roadmap: GLBA Safeguards Rule applies to you as a fintech handling consumer financial data (written infosec program, risk assessment, vendor management) → **SOC 2 Type I within yr 1, Type II yr 2** (Plaid production review and enterprise customers will push you here anyway). CCPA/state-privacy: data export + deletion already designed in. COPPA: 18+ only in ToS.
- S19 Data deletion: account deletion purges DB rows, blob artifacts, removes Plaid items, cancels Stripe subs — within 30 days, automated, logged.
- S20 Incident response runbook: detection → containment → user notification obligations (state breach laws).

---

## 8. Functional Requirements (consolidated)

**Accounts & identity**
- F1 Email/password + Google + Apple sign-in; email verification; MFA.
- F2 One user → many bank items → many accounts; merged dashboard with per-account filters.

**Data & sync**
- F3 Plaid initial sync (24 mo where available) + webhook-driven incremental sync + nightly sweep.
- F4 CSV import preserved (free tier + fallback) with the Phase-2 Quick-check flow; server-side parse.
- F5 Dedupe across sources; pending-transaction lifecycle handled.
- F6 Server-side classification: override → rules → Plaid category → Other; user recategorization with merchant-rule learning (existing behavior, now persisted in DB).

**Dashboard & analysis** (parity with today, server-backed)
- F7 Range tabs adapting to data span; overview cards with decryption count-up; clickable income/spending.
- F8 Donut + breakdown, cash flow (weekly/monthly auto), top merchants, outlier-aware avg monthly spend.
- F9 Ledger: server-side pagination/sort/filter/search; bulk recategorize; notes.
- F10 AI Advisor: all current insights + history tracking; later, LLM-generated narrative summaries (Azure OpenAI) on top of the deterministic engine — deterministic numbers, generated prose.
- F11 Budgets with alerts; Reports with PDF/CSV export.
- F12 Notifications: email (and later push) for sync failures, budget alerts, weekly digest.

**Billing**
- F13 Trial → Checkout → entitlements; Customer Portal; dunning; plan gates enforced server-side.

**Admin (internal)**
- F14 Admin console: user lookup, sync status, refund/cancel, feature flags, aggregate metrics (no transaction-detail browsing without explicit support-consent flag — privacy by default).

**Non-functional**
- N1 99.9% uptime target; p95 API < 400 ms; dashboard interactive < 2 s.
- N2 Scale: 10k users / ~15M transaction rows on single Postgres comfortably; partitioning plan beyond.
- N3 Accessibility WCAG 2.1 AA; prefers-reduced-motion honored (already done).
- N4 All infrastructure reproducible from IaC; blue/green deploys; CI/CD via GitHub Actions.

---

## 9. Build Roadmap

**Phase 0 — Foundation (weeks 1–3):** Azure subscription + IaC skeleton, environments, Entra External ID tenant, CI/CD, domain + Front Door, Postgres schema v1.
**Phase 1 — Core API + Auth (weeks 3–6):** REST API, user accounts, port classifier server-side, CSV import path end-to-end (feature parity with today, but hosted).
**Phase 2 — Plaid (weeks 6–10):** Sandbox integration, Link flow, sync engine, webhooks, reconnect flows; apply for production access early (review takes time).
**Phase 3 — Stripe (weeks 9–12):** Checkout, portal, webhooks, entitlements, pricing page.
**Phase 4 — Multi-page app (weeks 10–14):** React rebuild of all pages per §6, onboarding wizard, notifications.
**Phase 5 — Hardening & launch (weeks 14–18):** pen test, load test, GLBA program docs, legal pages (attorney review), beta cohort (50–100 users), then public launch.
**Phase 6 — Expansion:** budgets/goals v2, mobile apps (React Native), Azure OpenAI advisor narratives, shared/household accounts, net-worth tracking (Plaid investments + liabilities products), annual plans, affiliate/referral program.

---

## 10. Estimated Monthly Costs (early stage, ~500 paying users)

| Item | Est. cost |
|---|---|
| Azure (App Service S1, Postgres B2s+HA, Functions, Front Door, Key Vault, Monitor) | $250–450 |
| Plaid (transactions, ~600 connected items) | ≈ $900 at $1.50/item — but note the ~$500/mo platform minimum applies even below that (fact-checked §12) |
| Stripe fees (2.9% + 30¢ on ~$4k MRR) | ~$140 |
| Email (Resend/SendGrid), domain, misc SaaS | $50 |
| **Total infra** | **≈ $650–1,550/mo** vs ≈ $4,000 MRR |

One-time/periodic: pen test ($4–10k), SOC 2 Type I ($28–58k all-in: $5–25k audit + $7.5–12k/yr automation platform like Drata/Vanta + internal time — fact-checked §12), legal (ToS/privacy, ~$2–5k).

---

## 11. Key Risks & Mitigations

- **Plaid production approval** — start the application in Phase 2, not at launch; have privacy policy, security page, and data-deletion flow ready early.
- **Bank connection breakage** (the #1 support driver for every PFM app) — invest in the reconnect UX and proactive health notifications from day one.
- **Cost creep per user** — enforce item limits per tier; archive stale items; monitor Plaid per-item spend weekly.
- **Trust barrier** ("why should I link my bank to you?") — security page, SOC 2 badge ASAP, free CSV tier as a no-risk on-ramp, visible delete-everything button.
- **Regulatory** — you're a fintech the moment you hold transaction data: GLBA program documentation early; consult a fintech attorney before launch (this plan is not legal advice).
- **Differentiation** — vs Monarch/Copilot/Rocket Money: your angles are the AI Advisor's actionable savings math, the distinctive design, and aggressive privacy posture. Keep the free local-only tier as a unique wedge.

---

*Assumptions made (flag if wrong): pricing tiers are placeholders; React/TypeScript for the rebuild; PostgreSQL over Azure SQL; Entra External ID over Auth0; card-required trials; US-only at launch. All vendor prices are estimates — verify current Plaid/Stripe/Azure pricing during Phase 0.*


---

## 12. Fact-Check Notes (verified June 2026)

- **Plaid pricing — CORRECTED.** Transactions is a per-item monthly subscription, ≈ **$1.50/connected item/mo** at entry volume, and smaller deployments typically face a **~$500/mo platform minimum** (custom/volume pricing is negotiated). The original $200–900/mo estimate understated the floor: budget **$500/mo from the first Plaid production month**, which means roughly 150–200 paying users are needed before Plaid stops being the dominant cost. One "item" = one bank login (multiple accounts under one login = one item) — good for us.
- **Stripe — CONFIRMED, with an addition.** 2.9% + 30¢ per US online card transaction is current. **Stripe Billing adds 0.7% of recurring volume** for the subscription layer (Smart Retries, dunning, metering), and international cards (+1.5%) / currency conversion (+1%) / disputes ($15) raise the real blended take toward 4–5% for small-ticket subscriptions. On a $3.99 charge, fees ≈ $0.45 (~11%) — small-ticket monthly billing is fee-heavy; annual plans cut this meaningfully.
- **SOC 2 — REVISED UPWARD.** Type I audit fee alone: $5–25k. Realistic all-in for a small startup including an automation platform (Drata from ≈ $7.5k/yr; Vanta ≈ $10–12k/yr) and internal effort: **$28–58k**. Plan it for year 1–2, funded by revenue, not before launch.
- **PCI scope via Stripe Checkout (SAQ-A) — CONFIRMED** as standard practice when card data never touches your servers.
- **GLBA applicability — CONFIRMED** in substance: a consumer fintech handling transaction data falls under FTC Safeguards Rule expectations; written infosec program required. Attorney review still advised.
- **Margin impact of new tiers:** at $3.99 Personal the unit economics only work with the one-connection cap and a push to annual; Family ($10.99, one Plaid item per member worst case ≈ $7.50 cost) is the margin engine at 2–3 connected members typical; Enterprise ($24.99/seat) is comfortably margined and justifies the support load.

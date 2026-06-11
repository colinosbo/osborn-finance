# Osborn Finance — SaaS Platform

Production codebase for osbornfinance.com per the Enterprise Implementation Plan.

## Layout
- `server/` — Node.js + TypeScript REST API. Plaid + Stripe integrations (sandbox-ready), CSV import, classifier, advisor, entitlements. Runs fully offline in **mock mode** (no keys needed).
- `web/` — React + TypeScript SPA (Vite). Multi-page app with the icon nav: Dashboard, Accounts, Ledger, Advisor, Budgets, Reports, Plans, Settings.
- `infra/main.bicep` — Azure infrastructure as code: PostgreSQL Flexible Server, App Service, Key Vault, Storage, Application Insights.

## Run locally (zero accounts needed — mock mode)
```bash
cd server && npm install && npm run dev        # API on :4000, in-memory DB, mock Plaid/Stripe
cd web && npm install && npm run dev           # SPA on :5173, proxies /api to :4000
```
Sign-in is stubbed in dev: the SPA sends `x-user-email`; first request creates the user.

## Go live checklist (the parts that need YOUR accounts)
1. **Azure**: `az deployment sub create -f infra/main.bicep` after `az login`. Set the Postgres admin password + put secrets in Key Vault.
2. **Database**: set `DATABASE_URL`; migrations in `server/src/migrations/` run automatically at boot.
3. **Plaid**: create account → sandbox keys → set `PLAID_CLIENT_ID`/`PLAID_SECRET` (`PLAID_ENV=sandbox`). Apply for production access early.
4. **Stripe**: create products/prices for $3.99/$10.99/$24.99 → set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and the three `STRIPE_PRICE_*` ids.
5. **Auth**: create an Entra External ID tenant; set `AUTH_MODE=entra`, `ENTRA_JWKS_URL`, `ENTRA_AUDIENCE`. (Dev default: `AUTH_MODE=dev`.)
6. Point Front Door at the App Service, deploy `web/dist` to static hosting, done.

## Tests
```bash
cd server && npm test     # classifier parity, summary math, API e2e in mock mode
cd web && npm run build   # type-check + production build
```

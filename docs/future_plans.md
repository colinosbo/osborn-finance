# Osborn Finance — Future Plans

Short-form roadmap. Items move to the build tracker when work starts.

## Next up
- **Ask AI chatbot** — chat panel where users ask questions about their own spending ("why was March so expensive?"). Server-side route sends the user's summary + question to the Claude API (key in `.env`, never in the browser, mock mode until a key exists). Fast/cheap model (Haiku) keeps cost well under a cent per message. Gate to paid tiers.
- **Settings expansion** — dark mode shipped (on by default); add notification preferences, currency/date format, default time range, weekly email digest opt-in, MFA management once Entra is live.
- **Bank unlink data cleanup (bug)** — after unlinking a bank, that institution's data still shows in the app. Unlinking must fully remove the item's associated accounts/transactions (or clearly mark them removed) so nothing from the disconnected bank remains visible.
- **Profile section** — dedicated profile area for user identity details (name, email, avatar, account info) separate from Settings.
- **Budgets** — per-category monthly targets, progress bars, alerts at 80%/100%. Page stub exists.
- **Reports** — monthly/annual summaries, PDF + CSV export. Page stub exists.

## Go-live blockers (need accounts/budget — see README checklist)
- Azure deployment (`infra/main.bicep`), Entra External ID tenant, custom domain.
- Plaid sandbox keys → production approval (apply early; ~$500/mo platform minimum).
- Stripe products/prices for $3.99 / $10.99 / $24.99 + webhook secret.
- Legal: ToS, privacy policy, GLBA program docs; pen test before public launch.

## Later (Phase 6 from the enterprise plan)
- Family member invites + shared household dashboard (required before Family tier sells).
- Refund-splitting in the classifier (credits back to their spending category).
- Annual plans (2 months free), referral program.
- Mobile apps (React Native), net-worth tracking via Plaid investments/liabilities.
- HA database (ZoneRedundant) at ~$2k MRR; SOC 2 Type I in year 1.

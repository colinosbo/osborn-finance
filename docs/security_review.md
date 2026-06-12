# Osborn Finance — Internal Penetration Test & Security Review

**Date:** 2026-06-11
**Reviewer:** Internal (Claude-assisted)
**Commit reviewed:** `b1d247c` (HEAD)
**Scope:** Full application — Express/TypeScript API, React SPA, Azure Bicep infrastructure, SQL schema/migrations, Plaid + Stripe integrations. Assumes Plaid and Stripe are configured with live credentials and the Azure IaC is deployed as written.

> This review assumes a **white-box** posture (source access). It is a code-and-config audit, not a test against a running, internet-exposed deployment. Findings marked *(verify at runtime)* should be confirmed with dynamic testing once a staging environment exists.

---

## 1. Executive summary

The codebase is in good shape for its stage. A prior remediation pass (commit `e021bcc`, "17 review issues") already closed the highest-impact classes of bug: Stripe webhooks are HMAC-verified against the raw body, Plaid webhooks verify the rotating ES256 JWT and body hash, Plaid access tokens are envelope-encrypted with AES-256-GCM, SQL is fully parameterized with a whitelisted `ORDER BY`, the database runs private-only behind NSGs and a least-privilege application user, and Key Vault is private with RBAC and purge protection. Authorization is consistently scoped by the authenticated `user_id`, so there are no obvious IDOR holes.

What remains is mostly **defense-in-depth and operational hardening** rather than an open door. The two findings worth treating as priorities are the **`AUTH_MODE` default of `dev`** (a single missing env var collapses authentication entirely) and the **missing JWT `issuer` validation** (audience alone is not sufficient tenant isolation). Neither is exploitable as the infra is currently written, but both are fragile in a way that a financial product cannot afford.

**Findings by severity:** 2 High · 6 Medium · 6 Low · 4 Informational.

| # | Severity | Finding | Area |
|---|----------|---------|------|
| H1 | High | `AUTH_MODE` defaults to `dev`; misconfig = full auth bypass | Auth |
| H2 | High | Entra JWT verified for audience but not issuer | Auth |
| M1 | Medium | Storage account has no private endpoint / public network not disabled | Infra |
| M2 | Medium | No Key Vault RBAC role assignment for the App Service identity in IaC | Infra |
| M3 | Medium | No WAF / Azure Front Door in front of the public API & SPA | Infra |
| M4 | Medium | No diagnostic settings — security-relevant resource logs not collected | Infra |
| M5 | Medium | Token encryption key has no version/rotation envelope | Crypto |
| M6 | Medium | CSV import has no row-count cap (memory-pressure DoS) | App |
| L1 | Low | Plaid/Stripe error text propagated into logs | Logging |
| L2 | Low | `/api/health` discloses configuration to anonymous callers | Info disclosure |
| L3 | Low | `audit_log.ip_hash` column is never populated | Audit |
| L4 | Low | NSG egress to `Internet:443` is broad | Infra |
| L5 | Low | Postgres geo-redundant backup & HA disabled | Resilience |
| L6 | Low | `mfa_enabled` column defined but never enforced | Auth |
| I1 | Info | No automated dependency / `npm audit` gate | Supply chain |
| I2 | Info | Account auto-provisioning trusts the verified email claim | Auth |
| I3 | Info | No request-body schema validation library | Input |
| I4 | Info | Audit log stores PII (email, institution) with no retention policy | Privacy |

---

## 2. Methodology & scope

The review walked every server route from authentication middleware outward, traced each external-input path (HTTP body, query string, CSV upload, Plaid webhook, Stripe webhook) to its sink, and audited the IaC for network exposure, identity, and secret handling. Specific lenses applied: OWASP API Top 10 (broken object-level/function-level authz, injection, SSRF, security misconfiguration), payment-webhook trust boundaries, and Azure well-architected security baseline.

Out of scope: live dynamic testing (no running environment), third-party security of Plaid/Stripe/Entra themselves, and the standalone `free-tier/osborn_finance.html` demo (client-only, no backend trust).

---

## 3. High-severity findings

### H1 — `AUTH_MODE` defaults to `dev`, where any caller can impersonate any user

**Location:** `server/src/config.ts:3`, `server/src/index.ts` auth middleware (~L95–110)

In `dev` mode the API derives identity entirely from a client-supplied header:

```ts
const email = String(req.headers['x-user-email'] || '');
(req as never).user = await store.getOrCreateUser(email);
```

`authMode` is `process.env.AUTH_MODE || 'dev'`. If the app is ever started in production without `AUTH_MODE=entra` explicitly set, **every endpoint becomes an open door**: an attacker sends `x-user-email: victim@example.com` and reads/exports/deletes that user's transactions, accounts, and links a bank. The same default also activates the static dev encryption-key fallback path's sibling logic (the crypto fail-fast only triggers when `authMode !== 'dev'`), so a dev-mode prod boot would *also* run without a real `TOKEN_ENC_KEY`.

The Bicep does set `AUTH_MODE=entra` (`infra/modules.bicep`), so this is currently mitigated by IaC — but it is a single missing/typo'd app setting away from total compromise, with no second line of defense.

**Remediation:**
- Make `entra` the default and require an explicit, loud opt-in for dev mode (e.g. only honor `dev` when `NODE_ENV !== 'production'`).
- At startup, refuse to boot if `NODE_ENV === 'production'` and `authMode === 'dev'` — same fail-fast pattern already used for `TOKEN_ENC_KEY`.
- Consider stripping the `x-user-email` code path from production builds entirely.

---

### H2 — Entra JWT is validated for audience but not issuer

**Location:** `server/src/index.ts:116`

```ts
const { payload } = await jwtVerify(token, jwks, { audience: process.env.ENTRA_AUDIENCE });
```

The token's signature, expiry, and `aud` are checked, but `iss` is not. Audience validation alone does not pin the token to *your* Entra tenant/authority. If the configured JWKS endpoint serves keys for a multi-tenant authority, or if an attacker can obtain a validly-signed token carrying your audience from another tenant/app registration, it would be accepted. For a financial app this is the difference between "tokens from my identity provider" and "any token this key set ever signed for this audience."

**Remediation:** add `issuer: process.env.ENTRA_ISSUER` to the `jwtVerify` options and set it to your exact tenant issuer URL (e.g. `https://<tenant>.ciamlogin.com/<tenant-id>/v2.0`). Also consider validating `tid` (tenant id) and any required `scp`/`roles` claim. Fail closed if `ENTRA_ISSUER` is unset in prod.

---

## 4. Medium-severity findings

### M1 — Storage account is not network-isolated

**Location:** `infra/modules.bicep` storage resource (~L185–192), and `snet-pe` comment (~L70)

The `snet-pe` subnet is commented "private endpoints: Key Vault, Storage," but only a Key Vault private endpoint (`kvPe`) is actually declared. The storage account sets `allowBlobPublicAccess: false` and TLS 1.2 (good) but does **not** set `publicNetworkAccess: 'Disabled'` and has **no private endpoint** — it remains reachable over the public network, protected only by access keys. If that storage holds anything sensitive (exports, backups, logs), this is an exposed surface inconsistent with the otherwise private design.

**Remediation:** add a storage private endpoint in `snet-pe`, set `publicNetworkAccess: 'Disabled'` with `networkAcls.defaultAction: 'Deny'`, add a `privatelink.blob.core.windows.net` private DNS zone + VNet link, and prefer managed-identity (RBAC) access over account keys.

### M2 — No Key Vault RBAC role assignment for the App Service managed identity

**Location:** `infra/modules.bicep` — `api` site has `identity: SystemAssigned`, but no `Microsoft.Authorization/roleAssignments`

Key Vault uses `enableRbacAuthorization: true`, and the app comment says secrets arrive "via Key Vault references," but nothing grants the App Service's system-assigned identity the **Key Vault Secrets User** role. As written, Key Vault references will fail at runtime — and more importantly, RBAC grants aren't captured in IaC, so they'll be applied by hand (drift, over-broad grants, no review trail).

**Remediation:** add a `roleAssignment` resource granting the API's `identity.principalId` the *Key Vault Secrets User* role (`4633458b-17de-408a-b874-0445c86b69e6`) scoped to the vault. Keep all access in IaC.

### M3 — No WAF / Azure Front Door in front of the public endpoints

**Location:** `infra/modules.bicep` — `api` (App Service) and `spa` (Static Web App) are directly internet-facing

The App Service accepts inbound 443 straight from the Internet (NSG `allow-https-in`) with no Web Application Firewall, no managed rule set (OWASP CRS), no bot protection, and no DDoS Protection Standard. The app-layer `express-rate-limit` is in-process and per-instance, so it won't hold under a distributed flood or across scaled-out instances.

**Remediation:** front the API (and SPA) with Azure Front Door Premium + WAF policy (OWASP CRS + rate-based rules), restrict the App Service to accept traffic only from Front Door (service tag / header check), and enable DDoS Protection on the VNet. Move rate limiting to a shared store (Redis) if you keep app-layer limits.

### M4 — No diagnostic settings; security logs aren't collected

**Location:** `infra/modules.bicep` — App Insights exists, but no `Microsoft.Insights/diagnosticSettings` on Postgres, Key Vault, App Service, NSGs, or storage

There is application telemetry but no resource-level audit logging shipped to Log Analytics. Without Key Vault access logs, NSG flow logs, and Postgres audit logs you cannot detect or investigate credential misuse, exfiltration, or lateral movement after the fact — a gap for both incident response and any future SOC 2 / PCI-adjacent attestation.

**Remediation:** add `diagnosticSettings` routing each resource's audit/access logs to a Log Analytics workspace; enable NSG flow logs and Postgres `log_connections`/`pgaudit`; set retention to meet your compliance target.

### M5 — Token encryption key has no version or rotation envelope

**Location:** `server/src/crypto.ts`

Encryption is sound (AES-256-GCM, random IV, auth tag). But ciphertext carries no key identifier:

```ts
return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
```

A single static `TOKEN_ENC_KEY` means rotating the key makes **every stored Plaid access token undecryptable** — there's no way to tell which key encrypted a given blob, so you can't run two keys during a rotation window.

**Remediation:** prefix the blob with a key id/version byte and keep a small key map (current + previous), or delegate to Key Vault crypto (wrap/unwrap) so rotation is a Key Vault operation. Define a rotation runbook.

### M6 — CSV import has no row-count limit

**Location:** `server/src/index.ts` `/api/import/csv`, `server/src/csv.ts`

The body is capped at 12 MB, but within that limit `parseCSV` builds the entire row matrix in memory and the handler then builds `out[]`, fetches *all* existing tx keys into a `Set`, and inserts row-by-row. A crafted 12 MB file of minimal rows can produce a very large array and a large per-request memory/CPU spike; the insert loop issues one query per row. Repeated concurrently this is a cheap memory-pressure / DB-load DoS by any authenticated low-tier user.

**Remediation:** cap row count (e.g. reject > 10–20k data rows with `413`), batch inserts (multi-row `INSERT ... VALUES`), and consider streaming the parse. Lower the body limit if large imports aren't a real use case.

---

## 5. Low-severity findings

### L1 — Upstream error text propagated into logs
`server/src/plaid.ts` / `stripe.ts` throw `Error(\`plaid ${path} ${res.status}: ${await res.text()}\`)`, caught and `console.error`'d in the webhook handlers. Provider error bodies can contain request echoes or identifiers; avoid logging raw upstream bodies, and ensure App Insights isn't capturing tokens/PII. Log a correlation id instead.

### L2 — `/api/health` discloses configuration anonymously
`/api/health` returns `{ db, plaid env, stripe live/mock, auth mode }` with no auth. Minor, but it tells an attacker exactly which modes are live. Reduce to `{ ok: true }` for the public probe; gate the detailed view behind auth.

### L3 — `audit_log.ip_hash` is never written
The schema defines `ip_hash` but `store.audit()` never sets it, so audit entries can't be correlated to a source. Populate a salted hash of the client IP (respecting `X-Forwarded-For` behind Front Door).

### L4 — Broad NSG egress to `Internet:443`
`allow-out-internet-https` permits the app subnet to reach any internet host on 443 (needed for Plaid/Stripe). Tighten toward known egress (service tags / a NAT gateway with a pinned egress IP, or restrict to provider IP ranges) to limit exfiltration paths if the app is compromised.

### L5 — Postgres HA and geo-redundant backup disabled
`highAvailability: Disabled` (tracked) and `geoRedundantBackup: Disabled`. Availability/durability rather than confidentiality, but for financial data a regional outage means data loss beyond the 35-day local backups. Revisit at the noted MRR threshold.

### L6 — `mfa_enabled` defined but never enforced
The column exists; MFA is presumably delegated to Entra. Confirm MFA is required by Conditional Access policy in the tenant, since the app itself does not check it.

---

## 6. Informational

- **I1 — Supply chain:** no `npm audit` / Dependabot gate in the repo. Add an `npm audit --production` check (and SCA) to CI; pin and review the lockfiles.
- **I2 — Account provisioning:** `getOrCreateUserBySub` keys on the verified `sub` (correct) and trusts the `email` claim for display/linking. Fine given a verified token, but ensure email is a verified claim in your Entra user flow before using it for anything trust-bearing.
- **I3 — Input validation:** routes hand-roll validation. It's currently adequate (category whitelists, plan whitelists, parameterized SQL), but a schema validator (zod) on every body/query would prevent regressions as the surface grows.
- **I4 — Audit PII & retention:** `audit_log` stores email (on account deletion) and institution names. Define a retention/erasure policy so deletion is actually complete (GDPR/CCPA "right to erasure" vs. the audit trail).

---

## 7. What's already done well

- Stripe webhooks: HMAC over the **raw** body with timestamp tolerance and `timingSafeEqual` — correct, and registered before `express.json()`.
- Plaid webhooks: rotating ES256 JWT verified (alg/kid pinned, key cached with TTL) plus `request_body_sha256` body-hash check.
- Plaid plan/price trust: plan is derived from the Stripe **price id**, never a client-supplied field.
- Plaid access tokens: AES-256-GCM envelope encryption, key sourced from Key Vault in prod, hard fail-fast if the key is missing outside dev.
- SQL: fully parameterized; `ORDER BY` column and direction are whitelisted — no injection via sort.
- Authorization: every data query is scoped by the authenticated `user_id`; item deletion verifies ownership. No IDOR found.
- Network: Postgres is private-only (`publicNetworkAccess: Disabled`, delegated subnet), Key Vault is private with RBAC + purge protection, NSGs default-deny with explicit allows, least-privilege `osfinapp` DB user.
- Card data never touches the server (Stripe Checkout/Portal redirect model).
- No secrets in the repo; `.env` is git-ignored and `.env.example` is placeholder-only.

---

## 8. Prioritized remediation order

1. **H1, H2** — fail-closed auth defaults + JWT issuer pinning. Small code changes, highest risk reduction.
2. **M2, M1** — Key Vault role assignment (needed for the app to even read secrets) and storage isolation.
3. **M3, M4** — WAF/Front Door and diagnostic logging before public launch.
4. **M5, M6** — key rotation envelope and CSV import limits.
5. **Low / Info** — fold into normal hardening sprints.

*This is a static review; validate each item against a running staging environment, and re-run after the auth and infra changes land.*

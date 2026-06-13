# Osborn Finance — Profile Section Implementation Plan

**Status:** Draft / frontend-first
**Owner:** Web (React SPA)
**Depends on (later):** Entra External ID, API `/api/me` expansion, Azure
**Last updated:** 2026-06-12

---

## 1. Goal

Give users a dedicated **Profile** area to view and manage their personal information, security (password, MFA), preferences, and privacy controls. We build the **front end first** with mock/local handlers, then wire each action to the API and to Entra External ID. Nothing in this plan requires Azure to be live — every action degrades gracefully to a mock in dev mode, exactly like Plaid/Stripe already do.

---

## 2. The one architectural rule that shapes everything

Osborn Finance uses **Entra External ID** as its identity provider in production (`AUTH_MODE=entra`). That means:

- The **app never stores or handles passwords.** Password changes and resets happen on Entra-hosted pages (self-service password reset / SSPR).
- **MFA is enrolled and enforced by Entra** (Conditional Access + the combined "Security info" registration page). The app does not implement TOTP/SMS itself; it links the user to Entra to manage their methods.
- The app's job for these is to **deep-link** the user to the correct Entra flow and reflect status (e.g., "MFA: enabled").

So in the Profile UI, "Change password" and "Manage MFA" are **buttons that, in production, redirect to Entra**. For now they call mock handlers and show a toast. This keeps the design honest and avoids building auth UI we'd have to throw away.

Implication for the data model: profile fields the **app** owns (display name, avatar, preferences) are editable via our API; fields **Entra** owns (password, MFA methods, email verification) are read-only mirrors plus a deep-link.

---

## 3. Where Profile lives in the app

Today `Settings.tsx` mixes appearance, a tiny profile panel, billing, and security/data. Recommendation:

- **Add a new `/profile` route and page** (`web/src/pages/Profile.tsx`).
- Move **identity, security, sessions, and privacy** into Profile.
- Keep **Settings** for app preferences (appearance/theme, notifications, formats) and billing.
- Add a **Profile entry** to the nav. Put it on the right side next to Settings (an avatar/initials chip is the natural affordance).

Routing change in `App.tsx`:

```tsx
import Profile from './pages/Profile';
// ...
<Route path="/profile" element={<Profile toast={showToast} />} />
```

Nav (right cluster), an avatar chip that links to `/profile`:

```tsx
<div className="navright">
  <NavLink to="/profile" className={({isActive}) => 'navtab' + (isActive?' active':'')}>
    <span className="avatar-chip">{initials}</span>Profile
  </NavLink>
  <NavLink to="/settings" /* …unchanged… */>⚙ Settings</NavLink>
</div>
```

---

## 4. Profile page layout

Reuse the existing CSS vocabulary (`sec-head`, `panel`, `row2`, `controls`, `switchrow`, `btn`, `btn danger`, `psub`) so it looks native. Proposed sections (each a `panel`), top to bottom:

1. **Identity header** — avatar, display name, email, plan badge, member-since. The "at a glance" card.
2. **Personal information** — editable: display name, preferred name, phone, avatar; read-only: email (Entra-owned), user id.
3. **Sign-in & security** — password (deep-link to Entra SSPR), MFA status + manage (deep-link), last password change, recent sign-in activity link.
4. **Active sessions / devices** — list of sessions with revoke buttons (mock now; Entra/refresh-token revocation later).
5. **Notifications & preferences** — email digest, alerts, currency, date format, timezone, default time range, theme (some of these may stay in Settings; see §7).
6. **Privacy & data** — export all data (already exists), download a specific range, account deletion (already exists), retention info.
7. **Danger zone** — delete account, sign out everywhere.

Each editable panel follows the pattern: read-only summary → "Edit" toggles inline inputs → Save/Cancel. Save calls the API (mock in dev) and fires a toast, matching the current `Settings` UX.

---

## 5. Data model

### 5.1 Frontend type (now)

```ts
// web/src/types.ts (new)
export interface Profile {
  id: string;
  email: string;                 // Entra-owned, read-only
  emailVerified: boolean;        // from token claim later
  displayName: string;           // app-owned, editable
  preferredName?: string;
  phone?: string;
  avatarUrl?: string | null;
  plan: 'free' | 'personal' | 'family' | 'enterprise';
  memberSince?: string;          // ISO
  security: {
    mfaEnabled: boolean;         // mirrors users.mfa_enabled / Entra
    lastPasswordChange?: string; // ISO, from Entra later
    methods?: ('app'|'sms'|'email')[];
  };
  preferences: {
    theme: 'dark' | 'light';
    currency: string;            // 'USD'
    dateFormat: string;          // 'MM/DD/YYYY'
    timezone: string;            // IANA, e.g. 'America/New_York'
    defaultRangeDays: number;    // 30/90/365
    emailDigest: boolean;
    alerts: boolean;
  };
}
```

### 5.2 Backend mapping (later)

Most of this already has a home. `users` has `id, email, display_name, plan, stripe_customer_id, status, mfa_enabled, created_at`. To support the rest we'd add (a future migration, not now): `preferred_name`, `phone`, `avatar_url`, and a `user_preferences` table (or a `jsonb preferences` column). `memberSince` = `created_at`. `lastPasswordChange` / verified email come from **Entra**, not our DB.

---

## 6. API surface

### 6.1 What exists today

- `GET /api/me` → user + items + subscription.
- `GET /api/me/export` → full data export (JSON).
- `DELETE /api/me` → delete account (already audited with `ip_hash`).

### 6.2 What Profile adds (build mock-first)

| Method | Route | Purpose | Now (dev) | Later |
|---|---|---|---|---|
| `GET` | `/api/me/profile` | full profile incl. preferences | extend `/api/me` or new route returning mock-enriched user | read DB + token claims |
| `PATCH` | `/api/me/profile` | update name/phone/avatar | update `users` (validated via zod) | same |
| `PUT` | `/api/me/preferences` | save preferences | store in `user_preferences` | same |
| `POST` | `/api/me/avatar` | upload avatar | accept + store URL (mock returns a placeholder) | Blob Storage / Entra photo |
| `GET` | `/api/me/sessions` | list active sessions | mock list | Entra / refresh-token store |
| `POST` | `/api/me/sessions/revoke` | revoke a session | mock ok | Entra revocation |
| `GET` | `/api/me/security/password-change-url` | Entra SSPR deep-link | returns `null`/mock in dev | returns Entra URL |
| `GET` | `/api/me/security/mfa-url` | Entra security-info deep-link | mock | Entra URL |
| `GET` | `/api/me/activity` | recent security events | read `audit_log` (we now populate `ip_hash`) | same |

All new request bodies get **zod schemas** in `server/src/validate.ts` (the I3 pattern we just added), so validation is consistent.

### 6.3 Frontend client

Add small helpers to `web/src/api.ts` or just use the existing `api()` (it already handles method/body/errors). Add an `EMAIL`-style local fallback so the page renders with mock data when an endpoint 404s in early dev:

```ts
export async function getProfile(): Promise<Profile> {
  try { return await api<Profile>('/api/me/profile'); }
  catch { return mockProfile(); }   // dev-only fallback so UI is buildable today
}
```

---

## 7. Settings vs Profile — who owns what

To avoid duplication, draw the line clearly:

- **Profile:** identity (name, avatar, phone), email, password, MFA, sessions/devices, security activity, data export/delete, danger zone.
- **Settings:** appearance/theme (already there), notification toggles, currency/date/timezone formats, default time range, billing portal.
- **Shared truth:** preferences live in one place (`preferences` object / `user_preferences` table). If a control appears in both, it reads/writes the same source. Theme already persists to `localStorage` (`of_theme`) — keep that, and later sync it into `preferences` so it follows the user across devices.

---

## 8. Feature list — view/change personal info, security, and "other useful things"

Grouped by priority. ✅ = exists, 🟡 = build now (frontend + mock), 🔵 = needs Entra/Azure later.

**Identity & personal info**
- 🟡 Edit display name, preferred name, phone
- 🟡 Avatar upload / initials fallback / remove photo
- ✅/🟡 View email + plan + member-since (email read-only; verified badge 🔵)
- 🟡 Copy user id (support reference)

**Sign-in & security**
- 🔵 Change password (deep-link to Entra SSPR)
- 🔵 Manage MFA methods — authenticator app, SMS, email (deep-link to Entra security info)
- 🟡 MFA status indicator (enabled/disabled) sourced from `mfa_enabled`/token
- 🟡 "Last password change" and "MFA last updated" timestamps
- 🟡 Recent security activity (sign-ins, exports, bank link/unlink) from `audit_log`
- 🟡/🔵 Active sessions & devices with per-session "revoke", plus "sign out everywhere"
- 🔵 Login alerts (email on new-device sign-in)
- 🔵 Passkeys / WebAuthn (Entra supports; future)

**Connected accounts & billing**
- ✅ Linked banks summary (we have `/api/accounts`) with a link to Accounts page
- ✅ Billing portal (Stripe) — already in Settings; surface plan + "manage" here too
- 🟡 Current plan + usage (e.g., "1 of 1 bank connections used") — we already compute plan limits server-side

**Preferences (shared with Settings)**
- ✅ Theme (dark/light)
- 🟡 Currency, date format, timezone, default time range
- 🟡 Email digest opt-in, spending alerts, budget alerts

**Privacy & data (GLBA/CCPA posture already in the product)**
- ✅ Export all data (JSON)
- 🟡 Export a date range / CSV
- ✅ Delete account
- 🟡 Data retention summary + "what we store" link
- 🔵 Consent log / marketing preferences

**Nice-to-haves worth listing**
- 🟡 Profile completeness meter ("add a phone number to finish setup")
- 🟡 Accessibility prefs (reduce motion, larger text)
- 🔵 Language/locale
- 🔵 Household/family member management (ties to the Family tier already on the roadmap)
- 🔵 Emergency access / trusted contact
- 🟡 Sign-out button (clears dev email / triggers Entra logout in prod)

---

## 9. Phased rollout

**Phase 1 — Frontend only (this work).** New `Profile.tsx`, route, nav avatar chip, all panels rendered from a `getProfile()` that falls back to mock data. Editable panels use local state; Save fires a toast and updates local state. Password/MFA/sessions are mock handlers with clear "connects to Entra in production" copy. No backend changes required — it runs today in dev/mock mode.

**Phase 2 — Backend endpoints.** Add the `/api/me/profile`, `/preferences`, `/activity`, `/sessions` routes with zod validation; add the `user_preferences` table + `preferred_name/phone/avatar_url` columns via a new migration. Wire the page off mock onto real endpoints. Avatar upload targets Blob Storage (or a placeholder until storage exists).

**Phase 3 — Entra & Azure wiring.** Password and MFA buttons return real Entra deep-links; `mfaEnabled`, `emailVerified`, `lastPasswordChange` come from token claims / Microsoft Graph; sessions/revoke use Entra; login alerts via Entra risk events. This is the "link back to Azure" step.

---

## 10. Files to add / change

**New**
- `web/src/pages/Profile.tsx` — the page (sections from §4).
- `web/src/types.ts` — `Profile` and related types.
- `web/src/mock.ts` — `mockProfile()` and mock sessions/activity for Phase 1.
- (Phase 2) `server/src/migrations/003_profile_fields.sql` — `preferred_name`, `phone`, `avatar_url`, `user_preferences`.

**Edit**
- `web/src/App.tsx` — import + `/profile` route + nav avatar chip.
- `web/src/api.ts` — `getProfile()`/`updateProfile()`/`savePreferences()` helpers (thin wrappers over `api()`).
- `web/src/pages/Settings.tsx` — trim the profile/security/data panels that move to Profile; keep appearance + preferences + billing; add a "Manage profile →" link.
- `web/src/styles.css` — `.avatar-chip`, `.avatar`, `.profile-grid`, completeness meter, minor section styles.
- (Phase 2) `server/src/index.ts` + `server/src/validate.ts` + `server/src/store.ts` — new routes, schemas, store methods.

---

## 11. Acceptance criteria (Phase 1)

- A `/profile` route renders with avatar/initials, identity, security, preferences, and privacy panels using real `/api/me` data plus mock for the rest, in dev/mock mode with no Azure.
- Editing display name/phone updates the UI and toasts on Save; Cancel reverts.
- "Change password" and "Manage MFA" show clear copy that they connect to Entra in production (mock toast in dev), and reflect a mock/`mfa_enabled` status.
- Export and Delete continue to work (reuse existing endpoints).
- Theme stays consistent with the existing `of_theme` behavior.
- No regression to the existing tests; new backend routes (Phase 2) ship with zod validation and tests like the current suite.

---

## 12. Open questions

- Split Profile out of Settings (recommended) or keep one page with anchored sections?
- Avatar storage: Blob Storage vs. Entra profile photo vs. initials-only for v1?
- Do we surface household/family management here or on a dedicated page once the Family tier ships?
- Which preferences are device-local (theme today) vs. account-synced?

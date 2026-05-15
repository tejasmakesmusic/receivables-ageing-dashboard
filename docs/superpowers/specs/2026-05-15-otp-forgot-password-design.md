# OTP Passwordless Login + Forgot Password — Sub-project 2 Design Spec

**Date:** 2026-05-15
**Scope:** OTP passwordless login (magic link + 6-digit code) + forgot password / password reset
**Prerequisite:** Sub-project 1 (email/password auth) must be merged — this builds on its DB schema, session cookie system, and `email-auth.ts` module.

---

## Problem

After Sub-project 1, users can log in with Google OAuth or email+password. Two gaps remain:

1. **No passwordless option** — users who prefer not to manage passwords (or are locked out) have no alternative to Google OAuth.
2. **No password reset** — the "Forgot password?" link on the login page is disabled. Users who forget their password are stuck.

---

## Goals

1. OTP passwordless login: email a magic link + 6-digit code, either of which starts a session.
2. Forgot password / reset: any registered email (including Google-only accounts) can set or reset a password.
3. Login page gets "Email me a sign-in code" button and an enabled "Forgot password?" link.

---

## Architecture

### DB Migration

Five new nullable columns on `users`:

```sql
ALTER TABLE "users"
  ADD COLUMN "otp_code"                  VARCHAR(6),
  ADD COLUMN "otp_token"                 VARCHAR(64),
  ADD COLUMN "otp_expires_at"            TIMESTAMPTZ(6),
  ADD COLUMN "password_reset_token"      VARCHAR(64),
  ADD COLUMN "password_reset_expires_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "uq_users_otp_token"
  ON "users"("otp_token") WHERE "otp_token" IS NOT NULL;

CREATE UNIQUE INDEX "uq_users_password_reset_token"
  ON "users"("password_reset_token") WHERE "password_reset_token" IS NOT NULL;
```

Prisma schema additions (after `email_verification_expires_at`):

```prisma
otp_code                  String?   @db.VarChar(6)
otp_token                 String?   @unique(map: "uq_users_otp_token") @db.VarChar(64)
otp_expires_at            DateTime? @db.Timestamptz(6)
password_reset_token      String?   @unique(map: "uq_users_password_reset_token") @db.VarChar(64)
password_reset_expires_at DateTime? @db.Timestamptz(6)
```

### Pages

| Route | Type | Purpose |
|-------|------|---------|
| `/auth/login/otp` | `"use client"` page | Email entry form — user requests OTP |
| `/auth/login/otp/verify` | `"use client"` page | 6-digit code entry form; also the landing page for magic link clicks |
| `/auth/forgot-password` | `"use client"` page | Email entry form — user requests password reset link |
| `/auth/reset-password` | `"use client"` page | New password + confirm form; token passed via `?token=` query param |

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/otp/request` | POST | Generate OTP code + token, send email, return success |
| `/api/auth/otp/verify` | POST | Validate 6-digit code, set session cookie, return redirect URL |
| `/api/auth/otp/confirm` | GET | Validate magic link token, set session cookie, redirect |
| `/api/auth/forgot-password` | POST | Generate reset token, send reset email, return success |
| `/api/auth/reset-password` | POST | Validate reset token + new password, update `password_hash`, set session, return redirect URL |

### Login Page Changes

- Enable "Forgot password?" link (remove disabled state).
- Add a second divider + "Email me a sign-in code" button below the password form → navigates to `/auth/login/otp`.

---

## Data Flow

### OTP Login

1. User clicks "Email me a sign-in code" → `/auth/login/otp`
2. User enters email → `POST /api/auth/otp/request`
   - If email not registered: return `{ success: true }` (no enumeration)
   - If registered: generate `otp_code` (6-digit numeric), `otp_token` (32-byte hex), set `otp_expires_at = now + 15 min`
   - Save both to user record, send OTP email (magic link + code)
   - Return `{ success: true }`
3. Browser navigates to `/auth/login/otp/verify?email=<email>` (email passed as query param — displayed on page and included in the code POST body as `{ email, code }`)
4. **Path A — Magic link:** User clicks link in email → `GET /api/auth/otp/confirm?token=<token>`
   - Validate token (expiry check); race-safe: `findFirst` + conditional `updateMany`
   - Clear `otp_code`, `otp_token`, `otp_expires_at`; update `last_login_at`
   - Set session cookie, redirect to `/auth/pending` (PENDING role) or `/dashboard`
5. **Path B — Manual code:** User types 6-digit code on `/auth/login/otp/verify` → `POST /api/auth/otp/verify`
   - Validate code + email (expiry check); race-safe: `findFirst` + conditional `updateMany`
   - Clear OTP fields, update `last_login_at`
   - Set session cookie, return `{ redirectTo }` where `redirectTo = user.role === "PENDING" ? "/auth/pending" : "/dashboard"`

### Forgot Password / Reset

1. User clicks "Forgot password?" → `/auth/forgot-password`
2. User enters email → `POST /api/auth/forgot-password`
   - If email not registered: return `{ success: true }` (no enumeration)
   - If registered: generate `password_reset_token` (32-byte hex), set `password_reset_expires_at = now + 1 hour`
   - Save to user record, send reset email
   - Return `{ success: true }`
3. Browser shows static "Check your inbox" message
4. User clicks link in email → `/auth/reset-password?token=<token>`
5. User submits new password → `POST /api/auth/reset-password`
   - Find user by `password_reset_token` where `password_reset_expires_at > now`
   - Validate password ≥ 8 chars
   - Hash new password (bcrypt cost 12)
   - Race-safe `updateMany`: set `password_hash`, clear reset token + expiry
   - Set session cookie, return `{ redirectTo }` where `redirectTo = user.role === "PENDING" ? "/auth/pending" : "/dashboard"`
   - Google-only users (`password_hash` was null) get a password_hash set — now have both login paths

---

## Core Module Additions (`email-auth.ts`)

Five new exported functions:

### `requestOtp(email: string): Promise<true>`

- Looks up user by email; if not found, returns `true` silently.
- Generates `otp_code = Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")`.
- Generates `otp_token = randomBytes(32).toString("hex")`.
- Sets `otp_expires_at = now + 15 minutes`.
- Sends OTP email with both magic link and 6-digit code.
- Email send failures are caught and logged; always returns `true`.

### `verifyOtpCode(email: string, code: string): Promise<EmailUserRecord | null>`

- `findFirst` where `{ email, otp_code: code, otp_expires_at: { gt: now } }`.
- If not found: return `null`.
- Conditional `updateMany` where `{ id, otp_code: code }` → clears `otp_code`, `otp_token`, `otp_expires_at`, updates `last_login_at`.
- If `updateMany.count === 0` (race lost): return `null`.
- Returns updated user record.

### `verifyOtpToken(token: string): Promise<EmailUserRecord | null>`

- `findFirst` where `{ otp_token: token, otp_expires_at: { gt: now } }`.
- Conditional `updateMany` where `{ id, otp_token: token }` → clears all OTP fields, updates `last_login_at`.
- Returns updated user or `null`.

### `requestPasswordReset(email: string): Promise<true>`

- Looks up user by email; if not found, returns `true` silently.
- Generates `password_reset_token = randomBytes(32).toString("hex")`.
- Sets `password_reset_expires_at = now + 1 hour`.
- Sends reset email with link: `${baseUrl}/auth/reset-password?token=<token>`.
- Email send failures caught and logged; always returns `true`.

### `resetPassword(token: string, newPassword: string): Promise<EmailUserRecord | null>`

- Throws `Error("password_too_short")` if `newPassword.length < 8`.
- `findFirst` where `{ password_reset_token: token, password_reset_expires_at: { gt: now } }`.
- If not found: return `null`.
- Hash `newPassword` with bcrypt cost 12.
- Conditional `updateMany` where `{ id, password_reset_token: token }` → sets `password_hash`, clears reset token + expiry, updates `last_login_at`.
- If `updateMany.count === 0`: return `null`.
- Returns updated user record.

---

## Email Templates

### OTP Email

**Subject:** Your sign-in code — EMB Receivables

**Body:**
```html
<p>Hi [name],</p>
<p>Use either of these to sign in to EMB Receivables:</p>
<p><strong>Sign-in code: [CODE]</strong> (valid for 15 minutes)</p>
<p><a href="[MAGIC_LINK]">Or click here to sign in directly</a></p>
<p>If you didn't request this, you can ignore this email.</p>
<p>— EMB Receivables</p>
```

### Password Reset Email

**Subject:** Reset your password — EMB Receivables

**Body:**
```html
<p>Hi [name],</p>
<p>Click the link below to set a new password for your EMB Receivables account:</p>
<p><a href="[RESET_LINK]">Reset my password</a></p>
<p>This link expires in 1 hour.</p>
<p>If you didn't request a password reset, you can ignore this email.</p>
<p>— EMB Receivables</p>
```

---

## Security Constraints

| Constraint | Detail |
|-----------|--------|
| No user enumeration | OTP request and forgot-password return `{ success: true }` regardless of whether email is registered |
| Race-safe tokens | `findFirst` + conditional `updateMany` (WHERE includes token) — same pattern as Sub-project 1 |
| OTP 15-min TTL | Short window for live login action |
| Reset 1-hour TTL | Long enough to check email; short enough to limit exposure |
| Single-use tokens | Cleared atomically on first successful use |
| Password min 8 chars | Server-side in `resetPassword`; client-side on reset form |
| Session set on OTP/reset success | `setAuthSessionCookie(response, user.id)` — same as existing login |
| Google-only + reset | Allowed — `resetPassword` sets `password_hash` even if previously null |
| Open-redirect guard | `next` param: `startsWith("/") && !startsWith("//")`, default `/dashboard` |
| HTML injection in emails | `escapeHtml()` applied to `name` in all email templates |
| No rate limiting | Out of scope for Sub-project 2 |

---

## Error Handling

| Scenario | API response | UI message |
|----------|-------------|------------|
| OTP code wrong or expired | `{ error: "invalid_otp" }` 400 | "Invalid or expired code." |
| OTP magic link expired/used | Redirect to `/auth/login?error=token_expired` | Already handled by login page |
| Reset token expired/used | `{ error: "token_expired" }` 400 | "This link has expired. Request a new one." |
| Password too short on reset | `{ error: "password_too_short" }` 422 | "Password must be at least 8 characters." |
| Invalid JSON body | `{ error: "invalid_json" }` 400 | — |
| Validation failure | `{ error: "invalid_input" }` 422 | — |

---

## UI Components

No new primitives needed. Reuse `button.tsx`, `card.tsx`. Forms use native fetch + React state (same pattern as Sub-project 1 pages).

**`/auth/login/otp`** — centered card, email input, "Send sign-in code" button, "Back to sign in" link.

**`/auth/login/otp/verify`** — centered card, shows email address, 6-digit code input (auto-focus, numeric), "Verify code" button, "Resend code" link (re-POSTs to `/api/auth/otp/request`), "Back to sign in" link.

**`/auth/forgot-password`** — centered card, email input, "Send reset link" button, "Back to sign in" link. On success: shows "Check your inbox" confirmation inline (no page nav).

**`/auth/reset-password`** — centered card, password + confirm-password inputs, "Set new password" button. On success: redirects to `/dashboard`. If token missing/invalid on page load, shows error with link back to `/auth/forgot-password`.

---

## Files Created / Modified

| Action | Path |
|--------|------|
| Create | `prisma/migrations/<timestamp>_otp_password_reset/migration.sql` |
| Modify | `prisma/schema.prisma` — add 5 fields to `model users` |
| Modify | `src/server/core/email-auth.ts` — add 5 new exported functions |
| Modify | `src/server/core/__tests__/email-auth.test.ts` — add ~20 new test cases |
| Modify | `src/app/auth/login/page.tsx` — enable "Forgot password?" + add OTP button |
| Create | `src/app/auth/login/otp/page.tsx` |
| Create | `src/app/auth/login/otp/verify/page.tsx` |
| Create | `src/app/auth/forgot-password/page.tsx` |
| Create | `src/app/auth/reset-password/page.tsx` |
| Create | `src/app/api/auth/otp/request/route.ts` |
| Create | `src/app/api/auth/otp/verify/route.ts` |
| Create | `src/app/api/auth/otp/confirm/route.ts` |
| Create | `src/app/api/auth/forgot-password/route.ts` |
| Create | `src/app/api/auth/reset-password/route.ts` |
| Create | `src/app/api/auth/otp/request/__tests__/route.test.ts` |
| Create | `src/app/api/auth/otp/verify/__tests__/route.test.ts` |
| Create | `src/app/api/auth/otp/confirm/__tests__/route.test.ts` |
| Create | `src/app/api/auth/forgot-password/__tests__/route.test.ts` |
| Create | `src/app/api/auth/reset-password/__tests__/route.test.ts` |

---

## Testing

All tests use Vitest + `vi.hoisted(() => vi.fn())` + `vi.mock()` pattern.

### `email-auth.test.ts` additions

- `requestOtp` — user not found (returns true, no email sent), found + email queued, email send failure (returns true, token still saved)
- `verifyOtpCode` — valid code sets session fields, wrong code returns null, expired returns null, race condition (updateMany count=0) returns null
- `verifyOtpToken` — valid token, expired token, race condition
- `requestPasswordReset` — user not found (returns true), found + email queued, Google-only user (allowed), email send failure (returns true)
- `resetPassword` — valid token + password, expired token (null), race condition (null), password too short (throws), Google-only user gets password_hash set

### Route handler tests

- `POST /api/auth/otp/request` — happy path, invalid email format (422)
- `POST /api/auth/otp/verify` — valid code + redirect, invalid code (400), missing fields (422)
- `GET /api/auth/otp/confirm` — valid token + redirect, no token (400), expired token (redirect with error)
- `POST /api/auth/forgot-password` — happy path, invalid email format (422)
- `POST /api/auth/reset-password` — valid token + new password + redirect, expired token (400), password too short (422)

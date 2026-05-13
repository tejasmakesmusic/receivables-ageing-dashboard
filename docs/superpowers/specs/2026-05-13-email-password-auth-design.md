# Email/Password Auth — Sub-project 1 Design Spec

**Date:** 2026-05-13
**Scope:** Login page UI + email/password registration + email verification + password login
**Out of scope (Sub-project 2):** OTP passwordless login, forgot password / password reset

---

## Problem

The app currently only supports Google OAuth (`@emb.global` or any domain). External users and non-Google users have no login path. A login page UI does not exist — unauthenticated requests hit `/auth/google/login` which immediately redirects to Google.

---

## Goals

1. A branded login page at `/auth/login` offering Google OAuth and email/password as co-equal options.
2. Email/password registration with mandatory email verification before the user can log in.
3. New email-registered users land at `/auth/pending` (PENDING role) after verification, same as Google OAuth new users.
4. Existing Google OAuth users are unaffected.

---

## Architecture

### Pages (Next.js App Router — Server Components with Client form islands)

| Route | Type | Purpose |
|-------|------|---------|
| `/auth/login` | Page | Login hub: Google button + email/password form + register link |
| `/auth/register` | Page | Registration form: name, email, password, confirm password |
| `/auth/verify-email` | Page | Static "check your inbox" screen shown after registration |
| `/auth/verify-email/confirm` | Route Handler (GET) | Consumes token, marks email verified, redirects |

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/auth/register` | POST | Validate input, hash password, create user (`email_verified=false`, role=PENDING), send verification email |
| `/api/auth/login/password` | POST | Verify email+password, check `email_verified`, set session cookie |
| `/api/auth/verify-email/confirm` | GET | Validate token, set `email_verified=true`, redirect to `/auth/pending` |

### DB Migration

New nullable fields on the `users` table:

```prisma
password_hash                 String?   -- bcrypt hash, null for Google-only accounts
email_verified                Boolean   @default(false)
email_verification_token      String?   @unique
email_verification_expires_at DateTime?
```

Existing rows: `email_verified` defaults to `false`. The `getOrCreateGoogleUser()` function is updated to stamp `email_verified = true` on every Google OAuth login (Google verifies emails).

---

## Data Flow

### Registration
1. User submits `/auth/register` form (name, email, password, confirmPassword)
2. `POST /api/auth/register`:
   - Validate: email format, password ≥ 8 chars, passwords match, email not already taken
   - Hash password with bcrypt (cost factor 12)
   - Create `users` row: `role=PENDING`, `is_active=true`, `email_verified=false`, `email_verification_token=<random 32-byte hex>`, `email_verification_expires_at=now+24h`
   - Send verification email via `src/lib/email.ts` (Resend) with link: `${NEXTAUTH_URL}/api/auth/verify-email/confirm?token=<token>`
   - Return `{ success: true }` — do NOT set session cookie yet
3. Browser redirects to `/auth/verify-email` (static "check your inbox" page)

### Email Verification
1. User clicks link in email → `GET /api/auth/verify-email/confirm?token=<token>`
2. Find user by `email_verification_token` where `email_verification_expires_at > now`
3. Set `email_verified=true`, clear `email_verification_token` and `email_verification_expires_at`
4. Set session cookie (`setAuthSessionCookie`)
5. Redirect to `/auth/pending` (user has PENDING role — admin must promote)

### Password Login
1. User submits email + password on `/auth/login`
2. `POST /api/auth/login/password`:
   - Find user by email; return generic error if not found (no user enumeration)
   - Check `password_hash` is set (if null: account is Google-only → return `{ error: "use_google" }`)
   - Check `email_verified = true`; if false: return `{ error: "email_not_verified" }`
   - Verify password with bcrypt; if mismatch: return generic `{ error: "invalid_credentials" }`
   - Update `last_login_at`
   - Set session cookie, return `{ success: true }`
3. Browser redirects to `next` param or `/dashboard`

---

## Auth Redirect Change

`src/server/core/page-auth.ts` currently redirects unauthenticated users to `/auth/google/login`. Change to `/auth/login`. All existing pages using `requirePageRole` automatically benefit.

---

## Email Template

Single plain-text / simple HTML email:

**Subject:** Verify your email — EMB Receivables

**Body:**
```
Hi [name],

Click the link below to verify your email address and activate your account:

[VERIFY MY EMAIL]  →  https://receivablesageingdashboard.vercel.app/api/auth/verify-email/confirm?token=<token>

This link expires in 24 hours.

If you didn't create an account, you can ignore this email.

— EMB Receivables
```

---

## UI Components

No new primitives needed. Use existing: `button.tsx`, `card.tsx`. Build minimal form inputs inline (no react-hook-form — keep client-side JS minimal; use native form submission with server actions or a simple fetch).

**Login page layout:**
- Centered card (max-w-sm)
- App name / logo at top
- "Continue with Google" button (full width, existing OAuth flow)
- Divider: "or"
- Email + password inputs
- "Sign in" button
- "Forgot password?" link (visible but disabled — Sub-project 2)
- "Don't have an account? Register" link → `/auth/register`

**Register page layout:**
- Centered card
- Name, email, password, confirm-password fields
- "Create account" button
- "Already have an account? Sign in" link → `/auth/login`
- Client-side: confirm-password match validation only; all other validation on server

---

## Error Handling

| Scenario | Response |
|----------|----------|
| Email already registered | `{ error: "email_taken" }` → show "An account with this email already exists" |
| Google-only account tries password login | `{ error: "use_google" }` → show "This account uses Google sign-in" |
| Email not verified | `{ error: "email_not_verified" }` → show "Please verify your email first. Check your inbox." |
| Wrong password / user not found | `{ error: "invalid_credentials" }` → show "Invalid email or password" (no enumeration) |
| Expired verification token | Show "This link has expired. [Resend verification email]" — resend route: `POST /api/auth/verify-email/resend` |
| Password < 8 chars | Client-side + server-side validation |

---

## Security Constraints

- **bcrypt cost factor 12** — slow enough to deter brute force, fast enough for UX
- **No user enumeration** — registration success and login failure both return non-specific errors where appropriate
- **Token expiry** — verification tokens expire in 24 hours
- **Token single-use** — token cleared immediately on use
- **Session cookie** — httpOnly, Secure in production, SameSite=Lax, 12h TTL (existing system)
- **No rate limiting in this spec** — out of scope for Sub-project 1

---

## New Dependencies

| Package | Purpose |
|---------|---------|
| `bcryptjs` | Password hashing (pure JS, no native bindings — works on Vercel serverless) |
| `@types/bcryptjs` | TypeScript types |

Do NOT use `bcrypt` (requires native bindings that fail on Vercel). Use `bcryptjs`.

---

## Files Created / Modified

| Action | Path |
|--------|------|
| Create | `prisma/migrations/<timestamp>_email_password_auth/migration.sql` |
| Create | `src/app/auth/login/page.tsx` |
| Create | `src/app/auth/register/page.tsx` |
| Create | `src/app/auth/verify-email/page.tsx` |
| Create | `src/app/auth/verify-email/confirm/route.ts` |
| Create | `src/app/api/auth/register/route.ts` |
| Create | `src/app/api/auth/login/password/route.ts` |
| Create | `src/app/api/auth/verify-email/resend/route.ts` |
| Create | `src/server/core/email-auth.ts` |
| Modify | `src/server/core/auth.ts` — `getOrCreateGoogleUser` stamps `email_verified=true` |
| Modify | `src/server/core/page-auth.ts` — redirect to `/auth/login` |

---

## Testing

- Unit: `email-auth.ts` — createEmailPasswordUser, verifyEmailPassword, verifyEmailToken, generateVerificationToken
- Unit: `POST /api/auth/register` — happy path, duplicate email, short password, mismatched passwords
- Unit: `POST /api/auth/login/password` — happy path, wrong password, unverified email, google-only account
- Unit: `GET /api/auth/verify-email/confirm` — valid token, expired token, already-used token
- All tests use Vitest + vi.mock pattern (consistent with existing tests)

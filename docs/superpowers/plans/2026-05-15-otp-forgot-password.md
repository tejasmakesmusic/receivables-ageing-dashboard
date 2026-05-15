# OTP Passwordless Login + Forgot Password Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OTP passwordless login (magic link + 6-digit code) and forgot-password / password-reset to the existing email/password auth system.

**Architecture:** Five new nullable columns on the `users` table (otp_code, otp_token, otp_expires_at, password_reset_token, password_reset_expires_at) follow the same pattern as Sub-project 1's email-verification columns. New functions are appended to `src/server/core/email-auth.ts`. Route handlers and pages follow the exact same patterns as the existing auth routes.

**Tech Stack:** Next.js 16 App Router, Prisma 7 + Neon PostgreSQL, bcryptjs, Resend email, Vitest 4, Zod, React 19 `"use client"` pages.

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `prisma/migrations/20260515000000_otp_password_reset/migration.sql` | Add 5 columns + 2 partial unique indexes |
| Modify | `prisma/schema.prisma` | Add 5 fields to `model users` |
| Modify | `src/server/core/email-auth.ts` | Add 5 new exported functions + 2 private email helpers |
| Modify | `src/server/core/__tests__/email-auth.test.ts` | Add ~20 new test cases |
| Modify | `src/app/auth/login/page.tsx` | Enable Forgot Password link + add OTP button |
| Create | `src/app/auth/login/otp/page.tsx` | OTP email-entry form |
| Create | `src/app/auth/login/otp/verify/page.tsx` | OTP code-entry form + resend |
| Create | `src/app/auth/forgot-password/page.tsx` | Forgot-password email-entry form |
| Create | `src/app/auth/reset-password/page.tsx` | New-password form |
| Create | `src/app/api/auth/otp/request/route.ts` | POST — request OTP |
| Create | `src/app/api/auth/otp/verify/route.ts` | POST — verify 6-digit code |
| Create | `src/app/api/auth/otp/confirm/route.ts` | GET — handle magic link |
| Create | `src/app/api/auth/forgot-password/route.ts` | POST — request reset link |
| Create | `src/app/api/auth/reset-password/route.ts` | POST — set new password |
| Create | `src/app/api/auth/otp/request/__tests__/route.test.ts` | Route tests |
| Create | `src/app/api/auth/otp/verify/__tests__/route.test.ts` | Route tests |
| Create | `src/app/api/auth/otp/confirm/__tests__/route.test.ts` | Route tests |
| Create | `src/app/api/auth/forgot-password/__tests__/route.test.ts` | Route tests |
| Create | `src/app/api/auth/reset-password/__tests__/route.test.ts` | Route tests |

---

## Task 1: DB Migration + Prisma Schema

**Files:**
- Create: `prisma/migrations/20260515000000_otp_password_reset/migration.sql`
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Create migration SQL**

Create `prisma/migrations/20260515000000_otp_password_reset/migration.sql` with:

```sql
ALTER TABLE "users"
  ADD COLUMN "otp_code"                  VARCHAR(6),
  ADD COLUMN "otp_token"                 VARCHAR(64),
  ADD COLUMN "otp_expires_at"            TIMESTAMPTZ(6),
  ADD COLUMN "password_reset_token"      VARCHAR(64),
  ADD COLUMN "password_reset_expires_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "uq_users_otp_token"
  ON "users"("otp_token")
  WHERE "otp_token" IS NOT NULL;

CREATE UNIQUE INDEX "uq_users_password_reset_token"
  ON "users"("password_reset_token")
  WHERE "password_reset_token" IS NOT NULL;
```

- [ ] **Step 2: Update Prisma schema**

In `prisma/schema.prisma`, after the `email_verification_expires_at` line in `model users`, add:

```prisma
  otp_code                              String?                  @db.VarChar(6)
  otp_token                             String?                  @unique(map: "uq_users_otp_token") @db.VarChar(64)
  otp_expires_at                        DateTime?                @db.Timestamptz(6)
  password_reset_token                  String?                  @unique(map: "uq_users_password_reset_token") @db.VarChar(64)
  password_reset_expires_at             DateTime?                @db.Timestamptz(6)
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
npm run prisma:generate
```

Expected: `✔ Generated Prisma Client` — no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/20260515000000_otp_password_reset/migration.sql prisma/schema.prisma
git commit -m "feat(db): add otp and password_reset columns to users"
```

---

## Task 2: OTP Core Functions (`requestOtp`, `verifyOtpCode`, `verifyOtpToken`)

**Files:**
- Modify: `src/server/core/email-auth.ts`
- Modify: `src/server/core/__tests__/email-auth.test.ts`

- [ ] **Step 1: Add failing tests**

In `src/server/core/__tests__/email-auth.test.ts`, update the import line at the top (find the existing import block and add the three new names):

```typescript
import {
  generateVerificationToken,
  createEmailPasswordUser,
  verifyEmailPassword,
  verifyEmailToken,
  resendVerificationEmail,
  requestOtp,
  verifyOtpCode,
  verifyOtpToken,
} from "@/server/core/email-auth";
```

Then append three new describe blocks at the bottom of the file:

```typescript
describe("requestOtp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true without doing anything when user not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await requestOtp("nobody@example.com");
    expect(result).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("generates otp_code + otp_token, updates user, sends email, returns true", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice" });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await requestOtp("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({
        otp_code: expect.stringMatching(/^\d{6}$/),
        otp_token: expect.any(String),
        otp_expires_at: expect.any(Date),
      }),
    }));
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.subject).toContain("sign-in code");
    expect(emailArgs.html).toContain("sign in directly");
  });

  it("returns true even when email send fails (token still saved)", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice" });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockRejectedValue(new Error("SMTP error"));

    const result = await requestOtp("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

describe("verifyOtpCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user on valid code", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      otp_code: "123456",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
    });

    const result = await verifyOtpCode("a@b.com", "123456");
    expect(result).not.toBeNull();
    expect(result?.email).toBe("a@b.com");
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", otp_code: "123456" },
      data: expect.objectContaining({
        otp_code: null,
        otp_token: null,
        otp_expires_at: null,
        last_login_at: expect.any(Date),
      }),
    }));
  });

  it("returns null when code not found or expired (findFirst returns null)", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await verifyOtpCode("a@b.com", "000000");
    expect(result).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null on race condition (updateMany count=0)", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      otp_code: "123456",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await verifyOtpCode("a@b.com", "123456");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("verifyOtpToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user on valid token", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      otp_token: "abc123token",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
    });

    const result = await verifyOtpToken("abc123token");
    expect(result).not.toBeNull();
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", otp_token: "abc123token" },
      data: expect.objectContaining({
        otp_code: null,
        otp_token: null,
        otp_expires_at: null,
        last_login_at: expect.any(Date),
      }),
    }));
  });

  it("returns null when token not found or expired (findFirst returns null)", async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await verifyOtpToken("bad-token")).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null on race condition (updateMany count=0)", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      otp_token: "raced-token",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    expect(await verifyOtpToken("raced-token")).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/server/core/__tests__/email-auth.test.ts
```

Expected: 9 new test cases fail with `requestOtp is not a function` (or similar).

- [ ] **Step 3: Implement OTP functions in `email-auth.ts`**

Add the following after the `resendVerificationEmail` function in `src/server/core/email-auth.ts` (before the private `escapeHtml` helper):

```typescript
const OTP_EXPIRY_MINUTES = 15;

function generateOtpCode(): string {
  return Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0");
}

export async function requestOtp(email: string): Promise<true> {
  const prisma = getPrisma();
  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) return true;

  const otp_code = generateOtpCode();
  const otp_token = generateVerificationToken();
  const otp_expires_at = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await prisma.users.update({
    where: { id: user.id },
    data: { otp_code, otp_token, otp_expires_at },
  });

  try {
    await sendOtpEmail({ to: email, name: user.name, code: otp_code, token: otp_token });
  } catch (err) {
    console.error("[email-auth] requestOtp: email send failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

export async function verifyOtpCode(
  email: string,
  code: string,
): Promise<EmailUserRecord | null> {
  const prisma = getPrisma();
  const now = new Date();

  const user = await prisma.users.findFirst({
    where: { email, otp_code: code, otp_expires_at: { gt: now } },
  });
  if (!user) return null;

  const result = await prisma.users.updateMany({
    where: { id: user.id, otp_code: code },
    data: {
      otp_code: null,
      otp_token: null,
      otp_expires_at: null,
      last_login_at: new Date(),
    },
  });
  if (result.count === 0) return null;

  const updated = await prisma.users.findUnique({ where: { id: user.id } });
  return updated as unknown as EmailUserRecord;
}

export async function verifyOtpToken(
  token: string,
): Promise<EmailUserRecord | null> {
  const prisma = getPrisma();
  const now = new Date();

  const user = await prisma.users.findFirst({
    where: { otp_token: token, otp_expires_at: { gt: now } },
  });
  if (!user) return null;

  const result = await prisma.users.updateMany({
    where: { id: user.id, otp_token: token },
    data: {
      otp_code: null,
      otp_token: null,
      otp_expires_at: null,
      last_login_at: new Date(),
    },
  });
  if (result.count === 0) return null;

  const updated = await prisma.users.findUnique({ where: { id: user.id } });
  return updated as unknown as EmailUserRecord;
}
```

Also add the `sendOtpEmail` private function at the bottom of the file (after the existing `sendVerificationEmail` function):

```typescript
async function sendOtpEmail({
  to,
  name,
  code,
  token,
}: {
  to: string;
  name: string;
  code: string;
  token: string;
}) {
  const baseUrl = env.NEXTAUTH_URL ?? env.NEXT_PUBLIC_API_URL;
  const link = `${baseUrl}/api/auth/otp/confirm?token=${token}`;

  await sendEmail({
    to: [to],
    subject: "Your sign-in code — EMB Receivables",
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Use either of these to sign in to EMB Receivables:</p>
      <p><strong>Sign-in code: ${escapeHtml(code)}</strong> (valid for 15 minutes)</p>
      <p><a href="${link}">Or click here to sign in directly</a></p>
      <p>If you didn't request this, you can ignore this email.</p>
      <p>— EMB Receivables</p>
    `,
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/server/core/__tests__/email-auth.test.ts
```

Expected: All tests pass (existing 16 + new 9 = 25 total).

- [ ] **Step 5: Commit**

```bash
git add src/server/core/email-auth.ts src/server/core/__tests__/email-auth.test.ts
git commit -m "feat(auth): requestOtp + verifyOtpCode + verifyOtpToken"
```

---

## Task 3: Password Reset Core Functions (`requestPasswordReset`, `resetPassword`)

**Files:**
- Modify: `src/server/core/email-auth.ts`
- Modify: `src/server/core/__tests__/email-auth.test.ts`

- [ ] **Step 1: Add failing tests**

Update the import in `src/server/core/__tests__/email-auth.test.ts` — add the two new names:

```typescript
import {
  generateVerificationToken,
  createEmailPasswordUser,
  verifyEmailPassword,
  verifyEmailToken,
  resendVerificationEmail,
  requestOtp,
  verifyOtpCode,
  verifyOtpToken,
  requestPasswordReset,
  resetPassword,
} from "@/server/core/email-auth";
```

Append two new describe blocks at the bottom of the file:

```typescript
describe("requestPasswordReset", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true without doing anything when user not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await requestPasswordReset("nobody@example.com");
    expect(result).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("generates reset token, updates user, sends email, returns true", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice", password_hash: "some-hash" });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await requestPasswordReset("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({
        password_reset_token: expect.any(String),
        password_reset_expires_at: expect.any(Date),
      }),
    }));
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.subject).toContain("Reset your password");
  });

  it("works for Google-only accounts (null password_hash)", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "google@b.com", name: "G User", password_hash: null });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await requestPasswordReset("google@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("returns true even when email send fails (token still saved)", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice", password_hash: null });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockRejectedValue(new Error("SMTP error"));

    const result = await requestPasswordReset("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

describe("resetPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws password_too_short when password is under 8 characters", async () => {
    await expect(resetPassword("valid-token", "short")).rejects.toThrow("password_too_short");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns user and updates password_hash on valid token", async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      password_reset_token: "valid-reset-token",
      password_reset_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
      password_hash: "bcrypt-hash",
    });

    const result = await resetPassword("valid-reset-token", "newpassword123");
    expect(result).not.toBeNull();
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", password_reset_token: "valid-reset-token" },
      data: expect.objectContaining({
        password_hash: expect.any(String),
        password_reset_token: null,
        password_reset_expires_at: null,
        last_login_at: expect.any(Date),
      }),
    }));
    const updateData = mockUpdateMany.mock.calls[0][0].data;
    expect(updateData.password_hash).not.toBe("newpassword123");
  });

  it("returns null when token not found or expired", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await resetPassword("bad-token", "newpassword123");
    expect(result).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null on race condition (updateMany count=0)", async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      password_reset_token: "raced-token",
      password_reset_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await resetPassword("raced-token", "newpassword123");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/server/core/__tests__/email-auth.test.ts
```

Expected: 8 new test cases fail with `requestPasswordReset is not a function`.

- [ ] **Step 3: Implement password reset functions in `email-auth.ts`**

Add the following after `verifyOtpToken` in `src/server/core/email-auth.ts`:

```typescript
const RESET_EXPIRY_HOURS = 1;

export async function requestPasswordReset(email: string): Promise<true> {
  const prisma = getPrisma();
  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) return true;

  const password_reset_token = generateVerificationToken();
  const password_reset_expires_at = new Date(
    Date.now() + RESET_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  await prisma.users.update({
    where: { id: user.id },
    data: { password_reset_token, password_reset_expires_at },
  });

  try {
    await sendPasswordResetEmail({ to: email, name: user.name, token: password_reset_token });
  } catch (err) {
    console.error("[email-auth] requestPasswordReset: email send failed", {
      userId: user.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return true;
}

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<EmailUserRecord | null> {
  if (newPassword.length < 8) throw new Error("password_too_short");

  const prisma = getPrisma();
  const now = new Date();

  const user = await prisma.users.findFirst({
    where: { password_reset_token: token, password_reset_expires_at: { gt: now } },
  });
  if (!user) return null;

  const password_hash = await hash(newPassword, BCRYPT_COST);

  const result = await prisma.users.updateMany({
    where: { id: user.id, password_reset_token: token },
    data: {
      password_hash,
      password_reset_token: null,
      password_reset_expires_at: null,
      last_login_at: new Date(),
    },
  });
  if (result.count === 0) return null;

  const updated = await prisma.users.findUnique({ where: { id: user.id } });
  return updated as unknown as EmailUserRecord;
}
```

Also add the `sendPasswordResetEmail` private function at the bottom of the file (after `sendOtpEmail`):

```typescript
async function sendPasswordResetEmail({
  to,
  name,
  token,
}: {
  to: string;
  name: string;
  token: string;
}) {
  const baseUrl = env.NEXTAUTH_URL ?? env.NEXT_PUBLIC_API_URL;
  const link = `${baseUrl}/auth/reset-password?token=${token}`;

  await sendEmail({
    to: [to],
    subject: "Reset your password — EMB Receivables",
    html: `
      <p>Hi ${escapeHtml(name)},</p>
      <p>Click the link below to set a new password for your EMB Receivables account:</p>
      <p><a href="${link}">Reset my password</a></p>
      <p>This link expires in 1 hour.</p>
      <p>If you didn't request a password reset, you can ignore this email.</p>
      <p>— EMB Receivables</p>
    `,
  });
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/server/core/__tests__/email-auth.test.ts
```

Expected: All tests pass (25 existing + 8 new = 33 total).

- [ ] **Step 5: Commit**

```bash
git add src/server/core/email-auth.ts src/server/core/__tests__/email-auth.test.ts
git commit -m "feat(auth): requestPasswordReset + resetPassword"
```

---

## Task 4: OTP API Routes

**Files:**
- Create: `src/app/api/auth/otp/request/route.ts`
- Create: `src/app/api/auth/otp/verify/route.ts`
- Create: `src/app/api/auth/otp/confirm/route.ts`
- Create: `src/app/api/auth/otp/request/__tests__/route.test.ts`
- Create: `src/app/api/auth/otp/verify/__tests__/route.test.ts`
- Create: `src/app/api/auth/otp/confirm/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests for all three OTP routes**

Create `src/app/api/auth/otp/request/__tests__/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRequestOtp = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  requestOtp: mockRequestOtp,
}));

import { POST } from "@/app/api/auth/otp/request/route";

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/otp/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/otp/request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 and calls requestOtp on valid email", async () => {
    mockRequestOtp.mockResolvedValue(true);
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockRequestOtp).toHaveBeenCalledWith("alice@example.com");
  });

  it("returns 422 for invalid email format", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(422);
    expect(mockRequestOtp).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("https://example.com/api/auth/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

Create `src/app/api/auth/otp/verify/__tests__/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockVerifyOtpCode = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  verifyOtpCode: mockVerifyOtpCode,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { POST } from "@/app/api/auth/otp/verify/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: role_enum.ANALYST,
  is_active: true,
  email_verified: true,
};

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/otp/verify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with redirectTo and sets session cookie on valid code", async () => {
    mockVerifyOtpCode.mockResolvedValue(BASE_USER);
    const res = await POST(makeRequest({ email: "alice@example.com", code: "123456" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.redirectTo).toBe("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("returns 400 with invalid_otp on wrong or expired code", async () => {
    mockVerifyOtpCode.mockResolvedValue(null);
    const res = await POST(makeRequest({ email: "alice@example.com", code: "000000" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_otp");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 422 for missing fields", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(422);
  });

  it("redirects PENDING role to /auth/pending", async () => {
    mockVerifyOtpCode.mockResolvedValue({ ...BASE_USER, role: role_enum.PENDING });
    const res = await POST(makeRequest({ email: "alice@example.com", code: "123456" }));
    const body = await res.json();
    expect(body.redirectTo).toBe("/auth/pending");
  });
});
```

Create `src/app/api/auth/otp/confirm/__tests__/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockVerifyOtpToken = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  verifyOtpToken: mockVerifyOtpToken,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { GET } from "@/app/api/auth/otp/confirm/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: role_enum.ANALYST,
  is_active: true,
};

function makeRequest(token?: string) {
  const url = new URL("https://example.com/api/auth/otp/confirm");
  if (token) url.searchParams.set("token", token);
  return new NextRequest(url);
}

describe("GET /api/auth/otp/confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to /dashboard and sets session cookie on valid token", async () => {
    mockVerifyOtpToken.mockResolvedValue(BASE_USER);
    const res = await GET(makeRequest("valid-otp-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("redirects to /auth/login?error=token_invalid when token is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=token_invalid");
    expect(mockVerifyOtpToken).not.toHaveBeenCalled();
  });

  it("redirects to /auth/login?error=token_expired when token not found or expired", async () => {
    mockVerifyOtpToken.mockResolvedValue(null);
    const res = await GET(makeRequest("bad-or-expired"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=token_expired");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("redirects PENDING role to /auth/pending", async () => {
    mockVerifyOtpToken.mockResolvedValue({ ...BASE_USER, role: role_enum.PENDING });
    const res = await GET(makeRequest("valid-token"));
    expect(res.headers.get("location")).toContain("/auth/pending");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/app/api/auth/otp
```

Expected: All 11 tests fail with module-not-found errors.

- [ ] **Step 3: Implement the three OTP route handlers**

Create `src/app/api/auth/otp/request/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestOtp } from "@/server/core/email-auth";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  await requestOtp(parsed.data.email);
  return NextResponse.json({ success: true });
}
```

Create `src/app/api/auth/otp/verify/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOtpCode } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  const user = await verifyOtpCode(parsed.data.email, parsed.data.code);
  if (!user) {
    return NextResponse.json({ error: "invalid_otp" }, { status: 400 });
  }

  const redirectTo = user.role === role_enum.PENDING ? "/auth/pending" : "/dashboard";
  const response = NextResponse.json({ success: true, redirectTo });
  setAuthSessionCookie(response, user.id);
  return response;
}
```

Create `src/app/api/auth/otp/confirm/route.ts`:

```typescript
import { type NextRequest, NextResponse } from "next/server";
import { verifyOtpToken } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/auth/login?error=token_invalid", request.url));
  }

  const user = await verifyOtpToken(token);
  if (!user) {
    return NextResponse.redirect(new URL("/auth/login?error=token_expired", request.url));
  }

  const redirectTo = user.role === role_enum.PENDING ? "/auth/pending" : "/dashboard";
  const response = NextResponse.redirect(new URL(redirectTo, request.url));
  setAuthSessionCookie(response, user.id);
  return response;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/app/api/auth/otp
```

Expected: All 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/otp
git commit -m "feat(auth): OTP request/verify/confirm route handlers"
```

---

## Task 5: Forgot Password + Reset Password API Routes

**Files:**
- Create: `src/app/api/auth/forgot-password/route.ts`
- Create: `src/app/api/auth/reset-password/route.ts`
- Create: `src/app/api/auth/forgot-password/__tests__/route.test.ts`
- Create: `src/app/api/auth/reset-password/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/app/api/auth/forgot-password/__tests__/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRequestPasswordReset = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  requestPasswordReset: mockRequestPasswordReset,
}));

import { POST } from "@/app/api/auth/forgot-password/route";

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 and calls requestPasswordReset on valid email", async () => {
    mockRequestPasswordReset.mockResolvedValue(true);
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockRequestPasswordReset).toHaveBeenCalledWith("alice@example.com");
  });

  it("returns 422 for invalid email format", async () => {
    const res = await POST(makeRequest({ email: "bad" }));
    expect(res.status).toBe(422);
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("https://example.com/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
```

Create `src/app/api/auth/reset-password/__tests__/route.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockResetPassword = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  resetPassword: mockResetPassword,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { POST } from "@/app/api/auth/reset-password/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: role_enum.ANALYST,
  is_active: true,
};

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with redirectTo and sets session cookie on valid token + password", async () => {
    mockResetPassword.mockResolvedValue(BASE_USER);
    const res = await POST(makeRequest({ token: "valid-token", password: "newpass123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.redirectTo).toBe("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("returns 400 with token_expired on invalid or expired token", async () => {
    mockResetPassword.mockResolvedValue(null);
    const res = await POST(makeRequest({ token: "bad-token", password: "newpass123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("token_expired");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 422 with password_too_short when password is under 8 chars (Zod)", async () => {
    const res = await POST(makeRequest({ token: "valid-token", password: "short" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("password_too_short");
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("returns 422 for missing token", async () => {
    const res = await POST(makeRequest({ password: "newpass123" }));
    expect(res.status).toBe(422);
  });

  it("redirects PENDING role to /auth/pending", async () => {
    mockResetPassword.mockResolvedValue({ ...BASE_USER, role: role_enum.PENDING });
    const res = await POST(makeRequest({ token: "valid-token", password: "newpass123" }));
    const body = await res.json();
    expect(body.redirectTo).toBe("/auth/pending");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- src/app/api/auth/forgot-password src/app/api/auth/reset-password
```

Expected: All 8 tests fail with module-not-found errors.

- [ ] **Step 3: Implement the two route handlers**

Create `src/app/api/auth/forgot-password/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestPasswordReset } from "@/server/core/email-auth";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  await requestPasswordReset(parsed.data.email);
  return NextResponse.json({ success: true });
}
```

Create `src/app/api/auth/reset-password/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.password) return NextResponse.json({ error: "password_too_short" }, { status: 422 });
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  const user = await resetPassword(parsed.data.token, parsed.data.password);
  if (!user) {
    return NextResponse.json({ error: "token_expired" }, { status: 400 });
  }

  const redirectTo = user.role === role_enum.PENDING ? "/auth/pending" : "/dashboard";
  const response = NextResponse.json({ success: true, redirectTo });
  setAuthSessionCookie(response, user.id);
  return response;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- src/app/api/auth/forgot-password src/app/api/auth/reset-password
```

Expected: All 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/forgot-password src/app/api/auth/reset-password
git commit -m "feat(auth): forgot-password + reset-password route handlers"
```

---

## Task 6: Login Page — Enable Forgot Password + Add OTP Button

**Files:**
- Modify: `src/app/auth/login/page.tsx`

- [ ] **Step 1: Enable the "Forgot password?" link**

In `src/app/auth/login/page.tsx`, find the disabled span:

```tsx
<span className="cursor-not-allowed opacity-50">Forgot password?</span>
```

Replace it with an active link:

```tsx
<a
  href={`/auth/forgot-password?next=${encodeURIComponent(next)}`}
  className="hover:text-[var(--color-accent)]"
>
  Forgot password?
</a>
```

- [ ] **Step 2: Add the OTP button + divider below the password form**

Find the closing `</form>` tag (after the "Create account" link) and add the following immediately after it, still inside the card `<div>`:

```tsx
        <div className="relative my-4 flex items-center">
          <div className="flex-grow border-t border-[var(--color-border)]" />
          <span className="mx-3 text-xs text-[var(--color-text-muted)]">or</span>
          <div className="flex-grow border-t border-[var(--color-border)]" />
        </div>

        <a
          href={`/auth/login/otp?next=${encodeURIComponent(next)}`}
          className="flex w-full items-center justify-center rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)]"
        >
          Email me a sign-in code
        </a>
```

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/login/page.tsx
git commit -m "feat(ui): enable Forgot Password link + add OTP button on login page"
```

---

## Task 7: OTP Pages

**Files:**
- Create: `src/app/auth/login/otp/page.tsx`
- Create: `src/app/auth/login/otp/verify/page.tsx`

- [ ] **Step 1: Create the OTP request page**

Create `src/app/auth/login/otp/page.tsx`:

```tsx
"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function OtpRequestForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "server_error");
        return;
      }

      router.push(
        `/auth/login/otp/verify?email=${encodeURIComponent(email)}&next=${encodeURIComponent(next)}`,
      );
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text)]">
          EMB Receivables
        </h1>
        <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
          Enter your email to receive a sign-in code
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-xs font-medium text-[var(--color-text-muted)]">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--color-status-danger-text)]">
              {error === "invalid_input"
                ? "Please enter a valid email address."
                : "Something went wrong. Please try again."}
            </p>
          )}

          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? "Sending…" : "Send sign-in code"}
          </Button>

          <a
            href={`/auth/login?next=${encodeURIComponent(next)}`}
            className="mt-1 text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
          >
            Back to sign in
          </a>
        </form>
      </div>
    </main>
  );
}

export default function OtpRequestPage() {
  return (
    <Suspense>
      <OtpRequestForm />
    </Suspense>
  );
}
```

- [ ] **Step 2: Create the OTP verify page**

Create `src/app/auth/login/otp/verify/page.tsx`:

```tsx
"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function OtpVerifyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get("email") ?? "";
  const next = searchParams.get("next") ?? "/dashboard";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resent, setResent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "server_error");
        return;
      }

      router.push(data.redirectTo ?? next);
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResent(false);
    try {
      await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResent(true);
    } catch {
      // silently ignore — user can try again
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text)]">
          Check your inbox
        </h1>
        {email && (
          <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
            We sent a sign-in code and a magic link to{" "}
            <strong>{email}</strong>
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="code" className="text-xs font-medium text-[var(--color-text-muted)]">
              Sign-in code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-center text-lg font-mono tracking-[0.5em] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--color-status-danger-text)]">
              {error === "invalid_otp"
                ? "Invalid or expired code."
                : "Something went wrong. Please try again."}
            </p>
          )}

          {resent && (
            <p className="text-xs text-[var(--color-status-success-text)]">
              A new code has been sent.
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || code.length !== 6}
            className="mt-1 w-full"
          >
            {loading ? "Verifying…" : "Verify code"}
          </Button>

          <div className="mt-1 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
            <button
              type="button"
              onClick={handleResend}
              className="hover:text-[var(--color-accent)]"
            >
              Resend code
            </button>
            <a href="/auth/login" className="hover:text-[var(--color-accent)]">
              Back to sign in
            </a>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function OtpVerifyPage() {
  return (
    <Suspense>
      <OtpVerifyForm />
    </Suspense>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/login/otp
git commit -m "feat(ui): OTP request + verify pages"
```

---

## Task 8: Forgot Password + Reset Password Pages

**Files:**
- Create: `src/app/auth/forgot-password/page.tsx`
- Create: `src/app/auth/reset-password/page.tsx`

- [ ] **Step 1: Create the forgot-password page**

Create `src/app/auth/forgot-password/page.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      // Always show success — no enumeration
      setSubmitted(true);
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-2 text-center text-xl font-semibold text-[var(--color-text)]">
          EMB Receivables
        </h1>

        {submitted ? (
          <div className="text-center">
            <p className="mb-4 text-sm text-[var(--color-text-muted)]">
              If that email is registered, a password reset link is on its way.
              Check your inbox.
            </p>
            <a href="/auth/login" className="text-sm text-[var(--color-accent)] hover:underline">
              Back to sign in
            </a>
          </div>
        ) : (
          <>
            <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
              Enter your email and we&#39;ll send you a reset link
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="email"
                  className="text-xs font-medium text-[var(--color-text-muted)]"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
                />
              </div>

              {error && (
                <p className="text-xs text-[var(--color-status-danger-text)]">
                  Something went wrong. Please try again.
                </p>
              )}

              <Button type="submit" disabled={loading} className="mt-1 w-full">
                {loading ? "Sending…" : "Send reset link"}
              </Button>

              <a
                href="/auth/login"
                className="mt-1 text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-accent)]"
              >
                Back to sign in
              </a>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Create the reset-password page**

Create `src/app/auth/reset-password/page.tsx`:

```tsx
"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const errorMessages: Record<string, string> = {
    token_expired: "This reset link has expired.",
    password_too_short: "Password must be at least 8 characters.",
    passwords_mismatch: "Passwords do not match.",
    server_error: "Something went wrong. Please try again.",
  };

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
        <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm text-center">
          <p className="mb-4 text-sm text-[var(--color-text-muted)]">
            This reset link is invalid.
          </p>
          <a
            href="/auth/forgot-password"
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            Request a new one
          </a>
        </div>
      </main>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("passwords_mismatch");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "server_error");
        return;
      }

      router.push(data.redirectTo ?? "/dashboard");
    } catch {
      setError("server_error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-subtle)] p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-8 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold text-[var(--color-text)]">
          Set new password
        </h1>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="password"
              className="text-xs font-medium text-[var(--color-text-muted)]"
            >
              New password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="confirmPassword"
              className="text-xs font-medium text-[var(--color-text-muted)]"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-2 text-sm text-[var(--color-text)] outline-none focus:border-[var(--color-accent)] focus:ring-1 focus:ring-[var(--color-accent)]"
            />
          </div>

          {error && (
            <p className="text-xs text-[var(--color-status-danger-text)]">
              {errorMessages[error] ?? errorMessages.server_error}
              {error === "token_expired" && (
                <>
                  {" "}
                  <a
                    href="/auth/forgot-password"
                    className="underline"
                  >
                    Request a new link.
                  </a>
                </>
              )}
            </p>
          )}

          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? "Saving…" : "Set new password"}
          </Button>
        </form>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/auth/forgot-password src/app/auth/reset-password
git commit -m "feat(ui): forgot-password + reset-password pages"
```

---

## Task 9: Final Verification

**Files:** no changes — verification only

- [ ] **Step 1: Run the full test suite**

```bash
npm test
```

Expected: All tests pass. Pre-existing failures (if any) must be identical to the baseline before this work — no new failures.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors in files touched by this feature. Pre-existing errors in unrelated files (e.g., `workbooks.ts`) are acceptable and must not be new.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: No new errors or warnings. Fix any that appear in files you created or modified.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: Build succeeds. If it fails on a page you created, check for missing `Suspense` wrappers around `useSearchParams()` calls — every page that uses `useSearchParams()` must be wrapped in `<Suspense>`.

- [ ] **Step 5: Final commit if any fixes were made**

```bash
git add -p   # stage only the fix
git commit -m "fix(auth): typecheck / lint fixes for otp + password reset"
```

# Google OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `google_oauth_not_implemented` 501 stub with a real Google OAuth 2.0 Authorization Code flow using `google-auth-library`, while keeping the existing custom session cookie system intact.

**Architecture:** Login route redirects to Google when stub is disabled, setting a short-lived CSRF state cookie. Google redirects to a new `/auth/google/callback` route that exchanges the code, verifies the ID token, upserts the user, sets the `next_session` cookie, and redirects to the app. New users land at `/auth/pending`; returning users land at their intended destination.

**Tech Stack:** `google-auth-library` (OAuth2Client), Vitest, existing `signPayload`/`setAuthSessionCookie` from `src/server/core/auth.ts`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/env.ts` | Add `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` to Zod schema |
| Create | `src/lib/google-oauth.ts` | OAuth2Client factory, auth URL generation, state token helpers, code exchange |
| Modify | `src/server/core/auth.ts` | Add `getOrCreateGoogleUser()` |
| Create | `src/app/auth/google/callback/route.ts` | Handle Google redirect: verify state, exchange code, upsert user, set cookie |
| Modify | `src/app/auth/google/login/route.ts` | Redirect to Google when stub disabled |
| Create | `src/lib/__tests__/google-oauth.test.ts` | Unit tests for state helpers and exchangeCodeForUser |
| Create | `src/server/__tests__/auth-google-user.test.ts` | Unit tests for getOrCreateGoogleUser |
| Create | `src/app/auth/google/callback/__tests__/route.test.ts` | Unit tests for callback route |

---

## Task 1: Install `google-auth-library` and update `env.ts`

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/lib/env.ts`

- [ ] **Step 1: Install the package**

```bash
npm install google-auth-library
```

Expected: `added N packages` with no errors.

- [ ] **Step 2: Add Google OAuth vars to env schema**

In `src/lib/env.ts`, add two optional fields after `NEXTAUTH_URL`:

```typescript
  NEXTAUTH_URL: z.string().url().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
```

- [ ] **Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/env.ts
git commit -m "feat(auth): install google-auth-library, add OAuth env vars to schema"
```

---

## Task 2: Create `src/lib/google-oauth.ts`

**Files:**
- Create: `src/lib/google-oauth.ts`
- Create: `src/lib/__tests__/google-oauth.test.ts`

- [ ] **Step 1: Write failing tests first**

Create `src/lib/__tests__/google-oauth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock google-auth-library before importing the module under test
const mockGetToken = vi.fn();
const mockVerifyIdToken = vi.fn();
const mockGenerateAuthUrl = vi.fn();
const mockOAuth2Client = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    generateAuthUrl: mockGenerateAuthUrl,
    getToken: mockGetToken,
    verifyIdToken: mockVerifyIdToken,
  }))
);

vi.mock("google-auth-library", () => ({
  OAuth2Client: mockOAuth2Client,
}));

vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "production",
    NEXTAUTH_URL: "https://receivablesageingdashboard.vercel.app",
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
  },
}));

import {
  generateStateToken,
  parseStateToken,
  generateAuthUrl,
  exchangeCodeForUser,
} from "@/lib/google-oauth";

describe("generateStateToken", () => {
  it("returns a base64url state and a nonce", () => {
    const { state, nonce } = generateStateToken("/dashboard");
    expect(typeof state).toBe("string");
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("embeds the next path in the state", () => {
    const { state } = generateStateToken("/invoices");
    const parsed = parseStateToken(state);
    expect(parsed?.next).toBe("/invoices");
  });

  it("nonce in state matches returned nonce", () => {
    const { state, nonce } = generateStateToken("/dashboard");
    const parsed = parseStateToken(state);
    expect(parsed?.nonce).toBe(nonce);
  });
});

describe("parseStateToken", () => {
  it("returns null for invalid base64", () => {
    expect(parseStateToken("!!!notbase64!!!")).toBeNull();
  });

  it("returns null when nonce field is missing", () => {
    const bad = Buffer.from(JSON.stringify({ next: "/dashboard" })).toString("base64url");
    expect(parseStateToken(bad)).toBeNull();
  });

  it("returns null when next field is missing", () => {
    const bad = Buffer.from(JSON.stringify({ nonce: "abc" })).toString("base64url");
    expect(parseStateToken(bad)).toBeNull();
  });
});

describe("generateAuthUrl", () => {
  it("calls OAuth2Client.generateAuthUrl with the state", () => {
    mockGenerateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/auth?...");
    const url = generateAuthUrl("some-state");
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: "some-state" })
    );
    expect(url).toBe("https://accounts.google.com/o/oauth2/auth?...");
  });
});

describe("exchangeCodeForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user info from a valid id_token", async () => {
    mockGetToken.mockResolvedValue({
      tokens: { id_token: "fake.id.token" },
    });
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-sub-123",
        email: "alice@emb.global",
        name: "Alice",
        hd: "emb.global",
      }),
    });

    const user = await exchangeCodeForUser("auth-code");
    expect(user).toEqual({
      sub: "google-sub-123",
      email: "alice@emb.global",
      name: "Alice",
      hd: "emb.global",
    });
  });

  it("throws when getToken returns no id_token", async () => {
    mockGetToken.mockResolvedValue({ tokens: {} });
    await expect(exchangeCodeForUser("bad-code")).rejects.toThrow("No id_token");
  });

  it("throws when payload is missing email", async () => {
    mockGetToken.mockResolvedValue({ tokens: { id_token: "fake" } });
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "123" }),
    });
    await expect(exchangeCodeForUser("bad-code")).rejects.toThrow("Invalid token payload");
  });
});
```

- [ ] **Step 2: Run tests — confirm they all fail**

```bash
npm test src/lib/__tests__/google-oauth.test.ts
```

Expected: all tests FAIL with module not found or import errors.

- [ ] **Step 3: Create `src/lib/google-oauth.ts`**

```typescript
import { OAuth2Client } from "google-auth-library";
import { env } from "@/lib/env";

const CALLBACK_PATH = "/auth/google/callback";

function getCallbackUrl(): string {
  const base = env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}${CALLBACK_PATH}`;
}

function getOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    getCallbackUrl(),
  );
}

export interface StateToken {
  nonce: string;
  next: string;
}

export function generateStateToken(next: string): { state: string; nonce: string } {
  const nonce = crypto.randomUUID();
  const payload: StateToken = { nonce, next };
  const state = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state, nonce };
}

export function parseStateToken(state: string): StateToken | null {
  try {
    const raw = Buffer.from(state, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).nonce !== "string" ||
      typeof (parsed as Record<string, unknown>).next !== "string"
    ) {
      return null;
    }
    return parsed as StateToken;
  } catch {
    return null;
  }
}

export function generateAuthUrl(state: string): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: "online",
    scope: ["email", "profile"],
    state,
    prompt: "select_account",
  });
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  hd?: string;
}

export async function exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.id_token) {
    throw new Error("No id_token in Google token response");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) {
    throw new Error("Invalid token payload: missing email or sub");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    hd: payload.hd,
  };
}
```

- [ ] **Step 4: Run tests — confirm they all pass**

```bash
npm test src/lib/__tests__/google-oauth.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-oauth.ts src/lib/__tests__/google-oauth.test.ts
git commit -m "feat(auth): add google-oauth helpers (URL gen, state tokens, code exchange)"
```

---

## Task 3: Add `getOrCreateGoogleUser()` to `src/server/core/auth.ts`

**Files:**
- Modify: `src/server/core/auth.ts`
- Create: `src/server/__tests__/auth-google-user.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/__tests__/auth-google-user.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { role_enum } from "@/generated/prisma/enums";

const prismaMock = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: prismaMock.getPrisma,
}));

vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret-at-least-16-chars",
  },
}));

import { getOrCreateGoogleUser } from "@/server/core/auth";

const BASE_USER = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "alice@emb.global",
  name: "Alice",
  role: role_enum.ANALYST,
  entity_id_scope: null,
  is_active: true,
  last_login_at: null,
  google_sub: null,
};

function makeDb(overrides: Partial<{
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    users: {
      findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue(null),
      update: overrides.update ?? vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...BASE_USER, ...data })
      ),
      create: overrides.create ?? vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...BASE_USER, ...data, id: "new-uuid" })
      ),
    },
  };
}

describe("getOrCreateGoogleUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns existing user matched by google_sub without creating", async () => {
    const existingUser = { ...BASE_USER, google_sub: "g-sub-1" };
    const db = makeDb({
      findUnique: vi.fn().mockResolvedValueOnce(existingUser),
    });
    prismaMock.getPrisma.mockReturnValue(db);

    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: "g-sub-1",
      email: "alice@emb.global",
      name: "Alice",
    });

    expect(isNew).toBe(false);
    expect(user.id).toBe(BASE_USER.id);
    expect(db.users.create).not.toHaveBeenCalled();
  });

  it("falls back to email match and stamps google_sub when sub lookup misses", async () => {
    const existingUser = { ...BASE_USER, google_sub: null };
    const db = makeDb({
      findUnique: vi.fn()
        .mockResolvedValueOnce(null)          // google_sub lookup miss
        .mockResolvedValueOnce(existingUser), // email lookup hit
    });
    prismaMock.getPrisma.mockReturnValue(db);

    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: "g-sub-new",
      email: "alice@emb.global",
      name: "Alice",
    });

    expect(isNew).toBe(false);
    expect(db.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: BASE_USER.id },
        data: expect.objectContaining({ google_sub: "g-sub-new" }),
      })
    );
  });

  it("creates new PENDING user when both lookups miss", async () => {
    const db = makeDb({
      findUnique: vi.fn().mockResolvedValue(null),
    });
    prismaMock.getPrisma.mockReturnValue(db);

    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: "g-sub-brand-new",
      email: "newperson@emb.global",
      name: "New Person",
    });

    expect(isNew).toBe(true);
    expect(db.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "newperson@emb.global",
          google_sub: "g-sub-brand-new",
          role: role_enum.PENDING,
          is_active: true,
        }),
      })
    );
  });

  it("updates last_login_at for existing user", async () => {
    const existingUser = { ...BASE_USER, google_sub: "g-sub-1" };
    const db = makeDb({
      findUnique: vi.fn().mockResolvedValueOnce(existingUser),
    });
    prismaMock.getPrisma.mockReturnValue(db);

    await getOrCreateGoogleUser({
      googleSub: "g-sub-1",
      email: "alice@emb.global",
      name: "Alice",
    });

    expect(db.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ last_login_at: expect.any(Date) }),
      })
    );
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test src/server/__tests__/auth-google-user.test.ts
```

Expected: FAIL — `getOrCreateGoogleUser` is not exported.

- [ ] **Step 3: Add `getOrCreateGoogleUser` to `src/server/core/auth.ts`**

Add this export at the end of the file (after `ensureStubAdminUser`):

```typescript
export async function getOrCreateGoogleUser({
  googleSub,
  email,
  name,
}: {
  googleSub: string;
  email: string;
  name: string;
}): Promise<{ user: UserRecord; isNew: boolean }> {
  const prisma = getPrisma();
  const now = new Date();

  // 1. Match by google_sub (returning user on any device)
  const byGoogleSub = await prisma.users.findUnique({
    where: { google_sub: googleSub },
  });

  if (byGoogleSub) {
    await prisma.users.update({
      where: { id: byGoogleSub.id },
      data: { last_login_at: now },
    });
    return { user: byGoogleSub, isNew: false };
  }

  // 2. Match by email (handles stub-created accounts or prior signups)
  const byEmail = await prisma.users.findUnique({
    where: { email },
  });

  if (byEmail) {
    await prisma.users.update({
      where: { id: byEmail.id },
      data: { google_sub: googleSub, last_login_at: now },
    });
    return {
      user: { ...byEmail, google_sub: googleSub },
      isNew: false,
    };
  }

  // 3. Brand new user — create with PENDING role
  const newUser = await prisma.users.create({
    data: {
      email,
      name,
      google_sub: googleSub,
      role: role_enum.PENDING,
      is_active: true,
      last_login_at: now,
    },
  });

  return { user: newUser, isNew: true };
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm test src/server/__tests__/auth-google-user.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/core/auth.ts src/server/__tests__/auth-google-user.test.ts
git commit -m "feat(auth): add getOrCreateGoogleUser — upsert by google_sub then email"
```

---

## Task 4: Create the OAuth callback route

**Files:**
- Create: `src/app/auth/google/callback/route.ts`
- Create: `src/app/auth/google/callback/__tests__/route.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/app/auth/google/callback/__tests__/route.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockExchangeCodeForUser = vi.fn();
const mockGenerateStateToken = vi.fn();
const mockParseStateToken = vi.fn();
const mockGenerateAuthUrl = vi.fn();

vi.mock("@/lib/google-oauth", () => ({
  exchangeCodeForUser: mockExchangeCodeForUser,
  parseStateToken: mockParseStateToken,
  generateStateToken: mockGenerateStateToken,
  generateAuthUrl: mockGenerateAuthUrl,
}));

const mockGetOrCreateGoogleUser = vi.fn();
const mockSetAuthSessionCookie = vi.fn();

vi.mock("@/server/core/auth", () => ({
  getOrCreateGoogleUser: mockGetOrCreateGoogleUser,
  setAuthSessionCookie: mockSetAuthSessionCookie,
  isStubProviderEnabled: vi.fn().mockReturnValue(false),
}));

const mockCreateAuditLog = vi.fn();
vi.mock("@/server/core/audit", () => ({
  createAuditLog: mockCreateAuditLog,
}));

import { GET } from "@/app/auth/google/callback/route";

const BASE_USER = {
  id: "user-uuid",
  email: "alice@emb.global",
  name: "Alice",
  role: role_enum.ANALYST,
  entity_id_scope: null,
  is_active: true,
  last_login_at: null,
  google_sub: "g-sub-1",
};

function makeRequest(params: Record<string, string>, stateCookie?: string) {
  const url = new URL("https://receivablesageingdashboard.vercel.app/auth/google/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const req = new NextRequest(url);
  if (stateCookie) {
    req.cookies.set("google_oauth_state", stateCookie);
  }
  return req;
}

describe("GET /auth/google/callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to login when Google returns an error param", async () => {
    const req = makeRequest({ error: "access_denied" }, "nonce-abc");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/google/login");
  });

  it("redirects to login when code or state is missing", async () => {
    const req = makeRequest({ code: "abc" }); // no state
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/google/login");
  });

  it("redirects to login when state cookie is missing", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    const req = makeRequest({ code: "abc", state: "encoded-state" }); // no cookie
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/google/login");
  });

  it("redirects to login when nonce mismatch", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "DIFFERENT", next: "/dashboard" });
    const req = makeRequest({ code: "abc", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/google/login");
  });

  it("redirects to dashboard for an existing non-PENDING user", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockResolvedValue({
      sub: "g-sub-1", email: "alice@emb.global", name: "Alice",
    });
    mockGetOrCreateGoogleUser.mockResolvedValue({
      user: BASE_USER,
      isNew: false,
    });

    const req = makeRequest({ code: "valid-code", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("redirects to /auth/pending for PENDING role", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockResolvedValue({
      sub: "g-sub-new", email: "new@emb.global", name: "New",
    });
    mockGetOrCreateGoogleUser.mockResolvedValue({
      user: { ...BASE_USER, role: role_enum.PENDING },
      isNew: true,
    });

    const req = makeRequest({ code: "valid-code", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/pending");
  });

  it("redirects to login with error param when exchange throws", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockRejectedValue(new Error("token exchange failed"));

    const req = makeRequest({ code: "bad-code", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=oauth_failed");
  });

  it("clears the state cookie on success", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockResolvedValue({
      sub: "g-sub-1", email: "alice@emb.global", name: "Alice",
    });
    mockGetOrCreateGoogleUser.mockResolvedValue({ user: BASE_USER, isNew: false });

    const req = makeRequest({ code: "code", state: "state" }, "nonce-abc");
    const res = await GET(req);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("google_oauth_state=");
    expect(setCookie).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
npm test src/app/auth/google/callback/__tests__/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `src/app/auth/google/callback/route.ts`**

```typescript
import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForUser,
  parseStateToken,
} from "@/lib/google-oauth";
import {
  getOrCreateGoogleUser,
  setAuthSessionCookie,
} from "@/server/core/auth";
import { createAuditLog } from "@/server/core/audit";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

function safeRedirectPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");

  // User denied or Google returned an error
  if (searchParams.get("error")) {
    return NextResponse.redirect(new URL("/auth/google/login", request.url));
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(new URL("/auth/google/login", request.url));
  }

  // CSRF: verify state param matches the nonce stored in the cookie
  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  const stateData = parseStateToken(stateParam);

  if (!stateCookie || !stateData || stateData.nonce !== stateCookie) {
    return NextResponse.redirect(new URL("/auth/google/login", request.url));
  }

  try {
    const googleUser = await exchangeCodeForUser(code);
    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
    });

    const redirectPath =
      user.role === role_enum.PENDING
        ? "/auth/pending"
        : safeRedirectPath(stateData.next);

    const response = NextResponse.redirect(new URL(redirectPath, request.url));

    // Clear CSRF cookie
    response.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });

    setAuthSessionCookie(response, user.id);

    await createAuditLog(
      user.id,
      isNew ? "auth.google_signup" : "auth.google_login",
      "user",
      user.id,
      null,
      { email: user.email },
    );

    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/auth/google/login?error=oauth_failed", request.url),
    );
  }
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
npm test src/app/auth/google/callback/__tests__/route.test.ts
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/auth/google/callback/route.ts src/app/auth/google/callback/__tests__/route.test.ts
git commit -m "feat(auth): add Google OAuth callback route with CSRF state verification"
```

---

## Task 5: Update the login route to redirect to Google

**Files:**
- Modify: `src/app/auth/google/login/route.ts`

- [ ] **Step 1: Replace the 501 branch with a Google redirect**

Open `src/app/auth/google/login/route.ts`. The current file structure is:

```typescript
export async function GET(request: NextRequest) {
  try {
    if (!isStubProviderEnabled()) {
      return NextResponse.json(
        { error: "google_oauth_not_implemented" },
        { status: 501 },
      );
    }
    // ... stub flow
  }
}
```

Replace the entire file with:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ensureStubAdminUser,
  isStubProviderEnabled,
  setAuthSessionCookie,
} from "@/server/core/auth";
import { createAuditLog } from "@/server/core/audit";
import { role_enum } from "@/generated/prisma/enums";
import { toErrorResponse } from "@/server/core/errors";
import { generateAuthUrl, generateStateToken } from "@/lib/google-oauth";
import { env } from "@/lib/env";

const STATE_COOKIE = "google_oauth_state";

const loginResponseSchema = z.object({
  success: z.boolean(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.nativeEnum(role_enum),
  }),
});

type LoginResponse = z.infer<typeof loginResponseSchema>;

export const dynamic = "force-dynamic";

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }
  return value;
}

export async function GET(request: NextRequest) {
  try {
    const redirectPath = safeRedirectPath(
      request.nextUrl.searchParams.get("next"),
    );

    if (!isStubProviderEnabled()) {
      // Real Google OAuth — generate CSRF state and redirect
      const { state, nonce } = generateStateToken(redirectPath);
      const authUrl = generateAuthUrl(state);

      const response = NextResponse.redirect(authUrl);
      response.cookies.set(STATE_COOKIE, nonce, {
        httpOnly: true,
        maxAge: 300, // 5 minutes — long enough for the OAuth round-trip
        path: "/",
        secure: env.NODE_ENV === "production",
        sameSite: "lax",
      });
      return response;
    }

    // Stub flow (development / local)
    const user = await ensureStubAdminUser();
    const responsePayload: LoginResponse = {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };

    const wantsJson = request.nextUrl.searchParams.get("json") === "1";
    const response = wantsJson
      ? NextResponse.json(loginResponseSchema.parse(responsePayload))
      : NextResponse.redirect(new URL(redirectPath, request.url));
    setAuthSessionCookie(response, user.id);
    await createAuditLog(user.id, "auth.stub_login", "user", user.id, null, {
      id: user.id,
      email: user.email,
    });

    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 2: Run full test suite to confirm nothing regressed**

```bash
npm test
```

Expected: all tests PASS, no new failures.

- [ ] **Step 3: Run typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/auth/google/login/route.ts
git commit -m "feat(auth): wire Google OAuth redirect in login route, retire 501 stub"
```

---

## Task 6: Register callback URL + deploy

**Files:** None — manual step + deploy

- [ ] **Step 1: Add the callback URI to Google Cloud Console**

1. Open [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Open the OAuth 2.0 Client ID: `1013991960414-0ndoqghk4nsn9aq7ae4ld62ctr117iq7.apps.googleusercontent.com`
3. Under **Authorised redirect URIs**, add:
   ```
   https://receivablesageingdashboard.vercel.app/auth/google/callback
   ```
4. Save.

- [ ] **Step 2: Switch `AUTH_PROVIDER` back to `google` in Vercel production**

```bash
vercel env rm AUTH_PROVIDER production --yes
printf "google" | vercel env add AUTH_PROVIDER production
```

- [ ] **Step 3: Deploy to production**

```bash
vercel --prod
```

Expected: build READY, aliased to `https://receivablesageingdashboard.vercel.app`.

- [ ] **Step 4: Smoke test the login flow**

```bash
curl -s -o /dev/null -w "%{http_code}" https://receivablesageingdashboard.vercel.app/auth/google/login
```

Expected: `302` or `307` redirect to `accounts.google.com` (not `501` and not `google_oauth_not_implemented`).

- [ ] **Step 5: Full end-to-end browser test**

Open `https://receivablesageingdashboard.vercel.app` in a browser:
1. Should redirect to `/auth/google/login`
2. Should redirect to Google's OAuth consent screen
3. Sign in with `@emb.global` account
4. Should land at `/dashboard` with a valid session
5. Check `/api/auth/me` returns the logged-in user with correct role

- [ ] **Step 6: Commit any last changes**

```bash
git add -A
git commit -m "chore(auth): deploy Google OAuth to production"
```

---

## Self-Review

**Spec coverage:**
- ✅ Redirect to Google when stub disabled — Task 5
- ✅ CSRF state cookie — Tasks 4 + 5
- ✅ Code exchange + ID token verification — Task 2
- ✅ User upsert (by google_sub → email → create PENDING) — Task 3
- ✅ PENDING users land at `/auth/pending` — Task 4
- ✅ non-emb.global users create as PENDING (no hard block) — Task 3 (role defaults to PENDING for all new users)
- ✅ Audit logging for signup vs login — Task 4
- ✅ Callback URI registration — Task 6

**Placeholder scan:** None found.

**Type consistency:**
- `UserRecord` used in Task 3 matches the type defined in `auth.ts` (lines 34–42)
- `GoogleUserInfo` interface defined in Task 2, consumed in Task 4
- `STATE_COOKIE` constant `"google_oauth_state"` defined independently in login route (Task 5) and callback route (Task 4) — intentional duplication to keep routes self-contained

# Xero API Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Xero API ingestion path that creates UAE staged snapshots from Xero records while preserving Receivables OS ageing, staging, RBAC, audit, and publish rules.

**Architecture:** Xero stays outside the domain model as a source connector. The connector stores encrypted OAuth refresh tokens, fetches read-only invoices/contacts, normalizes them into the existing `ParseResult`/`ParsedInvoiceRow` shape, and hands off to the current snapshot staging/publish pipeline through a shared snapshot creation helper.

**Tech Stack:** Next.js 16 App Router route handlers, TypeScript, Prisma 7, Neon Postgres, Vercel environment variables, native `fetch`, Node `crypto`, Vitest.

---

## File Structure

- Create: `prisma/migrations/20260516000000_add_xero_connections/migration.sql`
  - Adds `xero_connections` and `xero_sync_runs`.
- Modify: `prisma/schema.prisma`
  - Adds Prisma models and relation fields for the two new tables.
- Modify: `src/lib/env.ts`
  - Adds optional Xero OAuth and token encryption environment variables.
- Create: `src/lib/secret-crypto.ts`
  - Encrypts/decrypts token material with AES-256-GCM.
- Test: `src/lib/__tests__/secret-crypto.test.ts`
  - Covers round trip, wrong key failure, and malformed ciphertext failure.
- Create: `src/server/xero/types.ts`
  - Defines typed boundaries for Xero API responses used by the app.
- Create: `src/server/xero/client.ts`
  - Owns OAuth URL generation, code exchange, token refresh, tenant listing, and Xero GET calls.
- Test: `src/server/__tests__/xero-client.test.ts`
  - Uses mocked `fetch`; no live Xero credentials.
- Create: `src/server/xero/normalizer.ts`
  - Converts Xero invoices/contacts into a `ParseResult`.
- Test: `src/server/__tests__/xero-normalizer.test.ts`
  - Fixture-based tests for valid open invoices, missing fields, unsupported currencies, and no Xero due-date ageing.
- Modify: `src/server/storage/workbooks.ts`
  - Adds a source-artifact object-key variant while preserving existing workbook behavior.
- Modify: `src/server/snapshots/service.ts`
  - Extracts a shared `createSnapshotFromParseResult` helper and adds `createSnapshotFromXeroPull`.
- Test: `src/server/__tests__/xero-snapshot-pull.test.ts`
  - Mocks Prisma and storage to verify RBAC, audit rows, sync-run states, duplicate detection, and parser-equivalent staging.
- Create: `src/server/xero/connections.ts`
  - ADMIN connection management and token persistence.
- Create: `src/app/api/admin/xero/connect/route.ts`
  - Starts OAuth.
- Create: `src/app/api/admin/xero/callback/route.ts`
  - Completes OAuth.
- Create: `src/app/api/admin/xero/disconnect/route.ts`
  - Disables a connection.
- Create: `src/app/api/xero/snapshots/pull/route.ts`
  - ANALYST/ADMIN read-only pull endpoint.
- Create: `src/app/admin/xero/page.tsx`
  - ADMIN connection status page.
- Create: `src/app/admin/xero/_components/disconnect-xero-button.tsx`
  - Client-side disconnect action that posts JSON and refreshes the page.
- Modify: `src/app/upload/_components/upload-snapshot-form.tsx`
  - Adds a UAE-only "Pull from Xero" action next to manual upload.
- Test: `src/server/__tests__/xero-route-guards.test.ts`
  - Structural route tests for ADMIN-only connection management and CFO/PENDING denial.
- Modify: `.env.example`
  - Documents Xero variables without real secrets.

---

### Task 1: Schema And Environment Foundation

**Files:**
- Create: `prisma/migrations/20260516000000_add_xero_connections/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write the migration**

Create `prisma/migrations/20260516000000_add_xero_connections/migration.sql`:

```sql
CREATE TABLE "xero_connections" (
  "id" UUID PRIMARY KEY,
  "entity_id" UUID NOT NULL,
  "tenant_id" VARCHAR(128) NOT NULL,
  "tenant_name" VARCHAR(255) NOT NULL,
  "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "encrypted_refresh_token" TEXT NOT NULL,
  "access_token_expires_at" TIMESTAMPTZ,
  "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  "connected_by" UUID NOT NULL,
  "disconnected_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "fk_xero_connections_entity_id_entities"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_xero_connections_connected_by_users"
    FOREIGN KEY ("connected_by") REFERENCES "users"("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "ck_xero_connections_status"
    CHECK ("status" IN ('ACTIVE', 'DISCONNECTED', 'ERROR'))
);

CREATE UNIQUE INDEX "uq_xero_connections_entity_tenant"
  ON "xero_connections"("entity_id", "tenant_id");

CREATE INDEX "ix_xero_connections_status"
  ON "xero_connections"("status");

CREATE TABLE "xero_sync_runs" (
  "id" UUID PRIMARY KEY,
  "connection_id" UUID NOT NULL,
  "snapshot_id" UUID,
  "triggered_by" UUID NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "finished_at" TIMESTAMPTZ,
  "pages_fetched" INTEGER NOT NULL DEFAULT 0,
  "invoices_seen" INTEGER NOT NULL DEFAULT 0,
  "invoices_staged" INTEGER NOT NULL DEFAULT 0,
  "parse_errors" INTEGER NOT NULL DEFAULT 0,
  "source_artifact_uri" TEXT,
  "source_artifact_sha256" VARCHAR(64),
  "error_code" VARCHAR(64),
  "error_message" TEXT,
  "rate_limit_json" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "fk_xero_sync_runs_connection_id_xero_connections"
    FOREIGN KEY ("connection_id") REFERENCES "xero_connections"("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "fk_xero_sync_runs_snapshot_id_snapshots"
    FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id") ON UPDATE NO ACTION ON DELETE SET NULL,
  CONSTRAINT "fk_xero_sync_runs_triggered_by_users"
    FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON UPDATE NO ACTION ON DELETE RESTRICT,
  CONSTRAINT "ck_xero_sync_runs_status"
    CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
);

CREATE INDEX "ix_xero_sync_runs_connection_started"
  ON "xero_sync_runs"("connection_id", "started_at" DESC);

CREATE INDEX "ix_xero_sync_runs_snapshot_id"
  ON "xero_sync_runs"("snapshot_id");
```

- [ ] **Step 2: Update Prisma schema**

Add these models to `prisma/schema.prisma` near the other source/import models:

```prisma
model xero_connections {
  id                        String           @id(map: "pk_xero_connections") @db.Uuid
  entity_id                 String           @db.Uuid
  tenant_id                 String           @db.VarChar(128)
  tenant_name               String           @db.VarChar(255)
  scopes                    String[]
  encrypted_refresh_token   String
  access_token_expires_at   DateTime?        @db.Timestamptz(6)
  status                    String           @default("ACTIVE") @db.VarChar(16)
  connected_by              String           @db.Uuid
  disconnected_at           DateTime?        @db.Timestamptz(6)
  created_at                DateTime         @default(now()) @db.Timestamptz(6)
  updated_at                DateTime         @default(now()) @db.Timestamptz(6)
  entities                  entities         @relation(fields: [entity_id], references: [id], onUpdate: NoAction, map: "fk_xero_connections_entity_id_entities")
  users_connected_by        users            @relation("xero_connections_connected_byTousers", fields: [connected_by], references: [id], onUpdate: NoAction, map: "fk_xero_connections_connected_by_users")
  xero_sync_runs            xero_sync_runs[]

  @@unique([entity_id, tenant_id], map: "uq_xero_connections_entity_tenant")
  @@index([status], map: "ix_xero_connections_status")
}

model xero_sync_runs {
  id                    String           @id(map: "pk_xero_sync_runs") @db.Uuid
  connection_id         String           @db.Uuid
  snapshot_id           String?          @db.Uuid
  triggered_by          String           @db.Uuid
  status                String           @default("RUNNING") @db.VarChar(16)
  started_at            DateTime         @default(now()) @db.Timestamptz(6)
  finished_at           DateTime?        @db.Timestamptz(6)
  pages_fetched         Int              @default(0)
  invoices_seen         Int              @default(0)
  invoices_staged       Int              @default(0)
  parse_errors          Int              @default(0)
  source_artifact_uri   String?
  source_artifact_sha256 String?         @db.VarChar(64)
  error_code            String?          @db.VarChar(64)
  error_message         String?
  rate_limit_json       Json?
  created_at            DateTime         @default(now()) @db.Timestamptz(6)
  updated_at            DateTime         @default(now()) @db.Timestamptz(6)
  xero_connections      xero_connections @relation(fields: [connection_id], references: [id], onUpdate: NoAction, map: "fk_xero_sync_runs_connection_id_xero_connections")
  snapshots             snapshots?       @relation(fields: [snapshot_id], references: [id], onDelete: SetNull, onUpdate: NoAction, map: "fk_xero_sync_runs_snapshot_id_snapshots")
  users_triggered_by    users            @relation("xero_sync_runs_triggered_byTousers", fields: [triggered_by], references: [id], onUpdate: NoAction, map: "fk_xero_sync_runs_triggered_by_users")

  @@index([connection_id, started_at], map: "ix_xero_sync_runs_connection_started")
  @@index([snapshot_id], map: "ix_xero_sync_runs_snapshot_id")
}
```

Add relation arrays to existing models:

```prisma
model entities {
  // existing fields...
  xero_connections xero_connections[]
}

model snapshots {
  // existing fields...
  xero_sync_runs xero_sync_runs[]
}

model users {
  // existing fields...
  xero_connections_connected_byTousers xero_connections[] @relation("xero_connections_connected_byTousers")
  xero_sync_runs_triggered_byTousers   xero_sync_runs[]   @relation("xero_sync_runs_triggered_byTousers")
}
```

- [ ] **Step 3: Add environment variables**

Update `src/lib/env.ts` inside `envSchema`:

```ts
  // Xero read-only ingestion
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  XERO_REDIRECT_URI: z.string().url().optional(),
  XERO_OAUTH_SCOPES: z
    .string()
    .default(
      "openid profile email offline_access accounting.transactions.read accounting.contacts.read accounting.reports.read",
    ),
  XERO_TOKEN_ENCRYPTION_KEY: z.string().min(32).optional(),
```

Update `.env.example` with comments only:

```bash
# Xero read-only ingestion. Required only when enabling direct Xero pulls.
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
XERO_REDIRECT_URI=http://localhost:3000/api/admin/xero/callback
XERO_OAUTH_SCOPES="openid profile email offline_access accounting.transactions.read accounting.contacts.read accounting.reports.read"
XERO_TOKEN_ENCRYPTION_KEY=
```

- [ ] **Step 4: Generate Prisma client and run checks**

Run:

```bash
npm run prisma:generate
npm run typecheck
```

Expected:

```text
Prisma schema loaded
Generated Prisma Client
```

`npm run typecheck` should finish with zero TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20260516000000_add_xero_connections/migration.sql prisma/schema.prisma src/lib/env.ts .env.example
git commit -m "feat: add Xero connection schema"
```

---

### Task 2: Token Encryption Helper

**Files:**
- Create: `src/lib/secret-crypto.ts`
- Test: `src/lib/__tests__/secret-crypto.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/secret-crypto.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

describe("secret crypto", () => {
  it("round-trips token material", () => {
    const secret = "x".repeat(40);
    const encrypted = encryptSecret("refresh-token", secret);

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("refresh-token");
    expect(decryptSecret(encrypted, secret)).toBe("refresh-token");
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptSecret("refresh-token", "a".repeat(40));
    expect(() => decryptSecret(encrypted, "b".repeat(40))).toThrow(
      "Secret decryption failed",
    );
  });

  it("rejects malformed ciphertext", () => {
    expect(() => decryptSecret("v1.not-enough-parts", "x".repeat(40))).toThrow(
      "Malformed encrypted secret",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/lib/__tests__/secret-crypto.test.ts
```

Expected: FAIL because `@/lib/secret-crypto` does not exist.

- [ ] **Step 3: Implement helper**

Create `src/lib/secret-crypto.ts`:

```ts
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";

function keyFromSecret(secret: string): Buffer {
  if (secret.length < 32) {
    throw new Error("Token encryption key must be at least 32 characters");
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(ciphertext: string, secret: string): string {
  const [version, ivText, tagText, encryptedText] = ciphertext.split(".");
  if (
    version !== VERSION ||
    !ivText ||
    !tagText ||
    !encryptedText ||
    ciphertext.split(".").length !== 4
  ) {
    throw new Error("Malformed encrypted secret");
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      keyFromSecret(secret),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("Secret decryption failed");
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/lib/__tests__/secret-crypto.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/secret-crypto.ts src/lib/__tests__/secret-crypto.test.ts
git commit -m "feat: encrypt Xero token secrets"
```

---

### Task 3: Xero API Client

**Files:**
- Create: `src/server/xero/types.ts`
- Create: `src/server/xero/client.ts`
- Test: `src/server/__tests__/xero-client.test.ts`

- [ ] **Step 1: Define Xero boundary types**

Create `src/server/xero/types.ts`:

```ts
export interface XeroTokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type: "Bearer" | string;
}

export interface XeroTenant {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

export interface XeroContact {
  ContactID?: string;
  Name?: string;
  ContactNumber?: string;
  EmailAddress?: string;
}

export interface XeroInvoice {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type?: string;
  Status?: string;
  Contact?: XeroContact;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  AmountDue?: number;
  Total?: number;
  CurrencyCode?: string;
  Reference?: string;
  SentToContact?: boolean;
  UpdatedDateUTC?: string;
}

export interface XeroInvoicesResponse {
  Invoices?: XeroInvoice[];
}
```

- [ ] **Step 2: Write failing tests**

Create `src/server/__tests__/xero-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildXeroAuthorizationUrl,
  exchangeCodeForTokens,
  fetchXeroJson,
  refreshAccessToken,
} from "@/server/xero/client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("xero client", () => {
  it("builds an OAuth authorization URL with read-only scopes", () => {
    const url = buildXeroAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "http://localhost:3000/api/admin/xero/callback",
      scopes: "openid profile email offline_access accounting.transactions.read",
      state: "state-token",
    });

    expect(url.origin).toBe("https://login.xero.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });

  it("exchanges an authorization code for tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 1800,
            token_type: "Bearer",
          }),
      }),
    );

    const tokens = await exchangeCodeForTokens({
      code: "abc",
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "http://localhost/callback",
    });

    expect(tokens.refresh_token).toBe("refresh");
  });

  it("refreshes an access token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 1800,
            token_type: "Bearer",
          }),
      }),
    );

    const tokens = await refreshAccessToken({
      refreshToken: "old-refresh",
      clientId: "client",
      clientSecret: "secret",
    });

    expect(tokens.access_token).toBe("new-access");
  });

  it("throws structured errors for failed Xero responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "60" }),
        text: () => Promise.resolve("rate limited"),
      }),
    );

    await expect(
      fetchXeroJson({
        accessToken: "access",
        tenantId: "tenant",
        path: "/Invoices",
      }),
    ).rejects.toMatchObject({
      code: "xero_api_error",
      status: 429,
      retryAfterSeconds: 60,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run:

```bash
npm test -- src/server/__tests__/xero-client.test.ts
```

Expected: FAIL because `@/server/xero/client` does not exist.

- [ ] **Step 4: Implement client**

Create `src/server/xero/client.ts`:

```ts
import type { XeroTenant, XeroTokenSet } from "@/server/xero/types";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const ACCOUNTING_API_URL = "https://api.xero.com/api.xro/2.0";

export class XeroApiError extends Error {
  readonly code = "xero_api_error";
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(params: {
    status: number;
    message: string;
    retryAfterSeconds?: number | null;
  }) {
    super(params.message);
    this.name = "XeroApiError";
    this.status = params.status;
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export function buildXeroAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
}): URL {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes);
  url.searchParams.set("state", input.state);
  return url;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

async function postTokenRequest(
  body: URLSearchParams,
  clientId: string,
  clientSecret: string,
): Promise<XeroTokenSet> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new XeroApiError({
      status: response.status,
      message: await response.text(),
    });
  }

  return (await response.json()) as XeroTokenSet;
}

export async function exchangeCodeForTokens(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<XeroTokenSet> {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    input.clientId,
    input.clientSecret,
  );
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<XeroTokenSet> {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
    input.clientId,
    input.clientSecret,
  );
}

async function parseXeroResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const retryAfter = response.headers.get("retry-after");
    throw new XeroApiError({
      status: response.status,
      message: await response.text(),
      retryAfterSeconds: retryAfter ? Number(retryAfter) : null,
    });
  }
  return (await response.json()) as T;
}

export async function listXeroTenants(
  accessToken: string,
): Promise<XeroTenant[]> {
  const response = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseXeroResponse<XeroTenant[]>(response);
}

export async function fetchXeroJson<T = unknown>(input: {
  accessToken: string;
  tenantId: string;
  path: string;
  searchParams?: Record<string, string>;
}): Promise<T> {
  const url = new URL(`${ACCOUNTING_API_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "xero-tenant-id": input.tenantId,
      Accept: "application/json",
    },
  });
  return parseXeroResponse<T>(response);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm test -- src/server/__tests__/xero-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/xero/types.ts src/server/xero/client.ts src/server/__tests__/xero-client.test.ts
git commit -m "feat: add Xero API client"
```

---

### Task 4: Xero Invoice Normalizer

**Files:**
- Create: `src/server/xero/normalizer.ts`
- Test: `src/server/__tests__/xero-normalizer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/server/__tests__/xero-normalizer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeXeroInvoicesToParseResult } from "@/server/xero/normalizer";

describe("xero normalizer", () => {
  it("normalizes open AED sales invoices into parser rows", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-1",
          InvoiceNumber: "INV-001",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: {
            ContactID: "contact-1",
            Name: "Acme LLC",
            EmailAddress: "ar@acme.example",
          },
          DateString: "2026-05-01T00:00:00",
          DueDateString: "2026-05-31T00:00:00",
          AmountDue: 1250.5,
          Total: 1250.5,
          CurrencyCode: "AED",
          Reference: "Project Alpha",
          SentToContact: true,
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "a".repeat(64),
    });

    expect(result.source_hint).toBe("XERO");
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({
      status: "OK",
      party_name_raw: "Acme LLC",
      xero_contact_id: "contact-1",
      invoice_ref: "INV-001",
      amount: "1250.50",
      source_currency: "AED",
      parse_error_reason: null,
    });
    expect(result.invoices[0].xero_metadata).toMatchObject({
      invoice_sent: "true",
      email: "ar@acme.example",
    });
  });

  it("stages missing required fields as PARSE_ERROR", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-2",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "contact-2" },
          AmountDue: 25,
          CurrencyCode: "AED",
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "b".repeat(64),
    });

    expect(result.is_valid).toBe(false);
    expect(result.invoices[0]).toMatchObject({
      status: "PARSE_ERROR",
      parse_error_reason:
        "Missing required Xero fields: Contact.Name, InvoiceNumber, Date",
    });
  });

  it("keeps unsupported currencies visible as PARSE_ERROR", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-3",
          InvoiceNumber: "INV-003",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "contact-3", Name: "USD Customer" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 100,
          CurrencyCode: "USD",
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "c".repeat(64),
    });

    expect(result.invoices[0]).toMatchObject({
      status: "PARSE_ERROR",
      parse_error_reason: "Unsupported Xero invoice currency: USD",
    });
  });

  it("does not copy Xero due date into ageing fields", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-4",
          InvoiceNumber: "INV-004",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "contact-4", Name: "Due Date Customer" },
          DateString: "2026-05-01T00:00:00",
          DueDateString: "2026-05-02T00:00:00",
          AmountDue: 100,
          CurrencyCode: "AED",
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "d".repeat(64),
    });

    expect(result.invoices[0].raw_row_json).toMatchObject({
      DueDateString: "2026-05-02T00:00:00",
    });
    expect(result.invoices[0]).not.toHaveProperty("due_date");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/server/__tests__/xero-normalizer.test.ts
```

Expected: FAIL because `@/server/xero/normalizer` does not exist.

- [ ] **Step 3: Implement normalizer**

Create `src/server/xero/normalizer.ts`:

```ts
import {
  makeParseError,
  makeParseResult,
  parseDateCell,
  type ParsedInvoiceRow,
} from "@/server/parsers/common";
import type { XeroInvoice } from "@/server/xero/types";

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseXeroDate(value: string | undefined): Date | null {
  if (!value) return null;
  try {
    return parseDateCell(value);
  } catch {
    return null;
  }
}

function decimalText(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

function stringifyRecord(invoice: XeroInvoice): Record<string, string | null> {
  return {
    InvoiceID: invoice.InvoiceID ?? null,
    InvoiceNumber: invoice.InvoiceNumber ?? null,
    Type: invoice.Type ?? null,
    Status: invoice.Status ?? null,
    ContactID: invoice.Contact?.ContactID ?? null,
    ContactName: invoice.Contact?.Name ?? null,
    ContactNumber: invoice.Contact?.ContactNumber ?? null,
    EmailAddress: invoice.Contact?.EmailAddress ?? null,
    Date: invoice.Date ?? null,
    DateString: invoice.DateString ?? null,
    DueDate: invoice.DueDate ?? null,
    DueDateString: invoice.DueDateString ?? null,
    AmountDue:
      typeof invoice.AmountDue === "number" ? String(invoice.AmountDue) : null,
    Total: typeof invoice.Total === "number" ? String(invoice.Total) : null,
    CurrencyCode: invoice.CurrencyCode ?? null,
    Reference: invoice.Reference ?? null,
    SentToContact:
      typeof invoice.SentToContact === "boolean"
        ? String(invoice.SentToContact)
        : null,
    UpdatedDateUTC: invoice.UpdatedDateUTC ?? null,
  };
}

function missingRequiredFields(invoice: XeroInvoice): string[] {
  const missing: string[] = [];
  if (!invoice.Contact?.Name?.trim()) missing.push("Contact.Name");
  if (!invoice.InvoiceNumber?.trim()) missing.push("InvoiceNumber");
  if (!invoice.DateString && !invoice.Date) missing.push("Date");
  if (typeof invoice.AmountDue !== "number") missing.push("AmountDue");
  return missing;
}

function normalizeInvoice(invoice: XeroInvoice, index: number): ParsedInvoiceRow {
  const rowIndex = index + 1;
  const rawRow = stringifyRecord(invoice);
  const invoiceDate = parseXeroDate(invoice.DateString ?? invoice.Date);
  const required = missingRequiredFields(invoice);

  let parseError: string | null = null;
  if (required.length > 0) {
    parseError = `Missing required Xero fields: ${required.join(", ")}`;
  } else if (!invoiceDate) {
    parseError = "Could not parse Xero invoice date";
  } else if (invoice.CurrencyCode !== "AED") {
    parseError = `Unsupported Xero invoice currency: ${invoice.CurrencyCode ?? "missing"}`;
  }

  return {
    row_index: rowIndex,
    status: parseError ? "PARSE_ERROR" : "OK",
    source_currency: "AED",
    party_name_raw: invoice.Contact?.Name ?? "",
    gstin: null,
    xero_contact_id: invoice.Contact?.ContactID ?? null,
    invoice_ref: invoice.InvoiceNumber ?? null,
    invoice_date: invoiceDate,
    amount: decimalText(invoice.AmountDue),
    raw_row_json: rawRow,
    xero_metadata: {
      invoice_seen: null,
      invoice_sent:
        typeof invoice.SentToContact === "boolean"
          ? String(invoice.SentToContact)
          : null,
      project_id: invoice.Reference ?? null,
      service_month: null,
      primary_person: null,
      email: invoice.Contact?.EmailAddress ?? null,
    },
    parse_error_reason: parseError,
  };
}

export function normalizeXeroInvoicesToParseResult(input: {
  invoices: XeroInvoice[];
  pulledAt: Date;
  fileSha256: string;
}) {
  const openInvoices = input.invoices.filter((invoice) => {
    if (invoice.Type !== "ACCREC") return false;
    if (invoice.Status === "VOIDED" || invoice.Status === "DELETED") {
      return false;
    }
    return typeof invoice.AmountDue === "number" && invoice.AmountDue > 0;
  });
  const rows = openInvoices.map(normalizeInvoice);
  const errors = rows
    .filter((row) => row.status === "PARSE_ERROR")
    .map((row) =>
      makeParseError(
        row.row_index,
        "XERO_API_ROW_PARSE_ERROR",
        row.parse_error_reason ?? "Xero row could not be normalized",
        { invoice_ref: row.invoice_ref, xero_contact_id: row.xero_contact_id },
      ),
    );

  return makeParseResult({
    invoices: rows,
    errors,
    warnings: [
      {
        row_index: -1,
        code: "XERO_API_SOURCE",
        message: `Xero API pull normalized on ${input.pulledAt.toISOString()}`,
        detail: { source_origin: "XERO_API", pulled_at: input.pulledAt.toISOString() },
      },
    ],
    as_of_date: new Date(`${dateOnly(input.pulledAt)}T00:00:00.000Z`),
    file_sha256: input.fileSha256,
    source_hint: "XERO",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm test -- src/server/__tests__/xero-normalizer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/xero/normalizer.ts src/server/__tests__/xero-normalizer.test.ts
git commit -m "feat: normalize Xero invoices for staging"
```

---

### Task 5: Shared Snapshot Creation Helper

**Files:**
- Modify: `src/server/storage/workbooks.ts`
- Modify: `src/server/snapshots/service.ts`
- Test: `src/server/__tests__/workbook-storage.test.ts`
- Test: `src/server/__tests__/xero-snapshot-pull.test.ts`

- [ ] **Step 1: Extend artifact storage tests**

Append to `src/server/__tests__/workbook-storage.test.ts`:

```ts
import { buildSourceArtifactObjectKey } from "@/server/storage/workbooks";

it("builds deterministic source artifact keys", () => {
  expect(
    buildSourceArtifactObjectKey({
      entityCode: "UAE",
      snapshotId: "snapshot-id",
      fileSha256: "a".repeat(64),
      fileName: "xero-api-pull.json",
    }),
  ).toBe(
    `source-artifacts/UAE/snapshot-id/${"a".repeat(64)}-xero-api-pull.json`,
  );
});
```

- [ ] **Step 2: Add artifact key helper**

Modify `src/server/storage/workbooks.ts`:

```ts
export function buildSourceArtifactObjectKey(
  input: WorkbookObjectKeyInput,
): string {
  return `source-artifacts/${input.entityCode}/${input.snapshotId}/${input.fileSha256}-${sanitizeFileName(input.fileName)}`;
}
```

Then update `storeUploadedWorkbook` to accept an optional key builder:

```ts
interface StoreUploadedWorkbookInput extends WorkbookObjectKeyInput {
  fileBytes: Uint8Array;
  env?: RuntimeEnv;
  putImpl?: BlobPutFn;
  objectKeyBuilder?: (input: WorkbookObjectKeyInput) => string;
}

// inside storeUploadedWorkbook, replace:
const key = buildWorkbookObjectKey(input);

// with:
const key = (input.objectKeyBuilder ?? buildWorkbookObjectKey)(input);
```

- [ ] **Step 3: Extract shared snapshot helper**

In `src/server/snapshots/service.ts`, extract the transaction body from
`createSnapshotFromUpload` into:

```ts
async function createSnapshotFromParseResult(params: {
  entity: { id: string; code: string };
  parseResult: ParseResult;
  effectiveAsOf: string | null;
  currentUser: AuthenticatedUser;
  snapshotId: string;
  fileSha256: string;
  uploadFilePath: string;
  storageKey: string | null;
  storageStored: boolean;
  sourceOrigin: "WORKBOOK_UPLOAD" | "XERO_API";
  columnMapping: ColumnMappingResultJson | null;
  auditAction?: string;
}): Promise<SnapshotCreateResponse> {
  const rowCount = snapshotRowCount(params.parseResult);
  const totalOutstanding = snapshotOutstanding(params.parseResult);

  await getPrisma().$transaction(async (tx) => {
    await tx.snapshots.create({
      data: {
        id: params.snapshotId,
        entity_id: params.entity.id,
        uploaded_by: params.currentUser.id,
        upload_file_path: params.uploadFilePath,
        upload_file_sha256: params.fileSha256,
        as_of_date: parseDateInput(params.effectiveAsOf),
        source_hint: params.parseResult.source_hint,
        status: "STAGED",
        row_count: rowCount,
        total_outstanding: totalOutstanding
          ? new Prisma.Decimal(totalOutstanding)
          : null,
        parse_result_json: serializeParseResult(
          params.parseResult,
        ) as unknown as Prisma.InputJsonValue,
        column_mapping_json: params.columnMapping
          ? (params.columnMapping as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        warnings_acknowledged_json: [],
        staging_overrides_json: [],
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: params.currentUser.id,
        action: params.auditAction ?? "snapshot.create",
        entity_type: "snapshots",
        entity_id: params.snapshotId,
        before: Prisma.JsonNull,
        after: {
          entity_code: params.entity.code,
          source_hint: params.parseResult.source_hint,
          source_origin: params.sourceOrigin,
          as_of_date: params.effectiveAsOf,
          row_count: rowCount,
          file_sha256: params.fileSha256,
          upload_file_path: params.uploadFilePath,
          workbook_storage_key: params.storageKey,
          workbook_stored: params.storageStored,
        },
      },
    });
  });

  return {
    snapshot_id: params.snapshotId,
    status: "STAGED",
    entity_code: params.entity.code as EntityCode,
    source_hint: params.parseResult.source_hint,
    as_of_date: params.effectiveAsOf,
    row_count: rowCount,
    file_sha256: params.fileSha256,
    warnings_count: params.parseResult.warnings.length,
    errors_count: params.parseResult.errors.length,
  };
}
```

Update `createSnapshotFromUpload` to call this helper after storage and column
mapping drift logic. The public response must be unchanged.

- [ ] **Step 4: Add Xero pull service skeleton**

In `src/server/snapshots/service.ts`, add an exported function that currently
accepts already-fetched invoices. This keeps Task 5 testable before connection
management lands:

```ts
export async function createSnapshotFromXeroPull(params: {
  entityCode: "UAE";
  invoices: import("@/server/xero/types").XeroInvoice[];
  currentUser: AuthenticatedUser;
  pulledAt?: Date;
}): Promise<SnapshotCreateResponse> {
  const prisma = getPrisma();
  const entity = await prisma.entities.findUnique({
    where: { code: params.entityCode },
    select: { id: true, code: true },
  });
  if (!entity) {
    throw new HttpError("not_found", 404, "Entity not found");
  }
  await assertAnalystCanAccessEntity(params.currentUser, entity.id);

  const pulledAt = params.pulledAt ?? new Date();
  const sourcePayload = {
    source_origin: "XERO_API",
    pulled_at: pulledAt.toISOString(),
    invoices: params.invoices,
  };
  const sourceBytes = new Uint8Array(
    Buffer.from(JSON.stringify(sourcePayload), "utf8"),
  );
  const fileSha256 = computeFileSha256(sourceBytes);

  const duplicate = await prisma.snapshots.findUnique({
    where: { upload_file_sha256: fileSha256 },
    select: { id: true },
  });
  if (duplicate) {
    throw new HttpError(
      "duplicate_snapshot",
      409,
      "This Xero pull has already been staged",
    );
  }

  const snapshotId = createId();
  const parseResult = normalizeXeroInvoicesToParseResult({
    invoices: params.invoices,
    pulledAt,
    fileSha256,
  });
  const storedArtifact = await storeUploadedWorkbook({
    fileBytes: sourceBytes,
    fileName: `xero-api-pull-${pulledAt.toISOString().slice(0, 10)}.json`,
    entityCode: entity.code as EntityCode,
    snapshotId,
    fileSha256,
    objectKeyBuilder: buildSourceArtifactObjectKey,
  });

  return createSnapshotFromParseResult({
    entity,
    parseResult,
    effectiveAsOf: toDate(parseResult.as_of_date),
    currentUser: params.currentUser,
    snapshotId,
    fileSha256,
    uploadFilePath: storedArtifact.uri,
    storageKey: storedArtifact.key,
    storageStored: storedArtifact.stored,
    sourceOrigin: "XERO_API",
    columnMapping: null,
    auditAction: "snapshot.create_xero_api",
  });
}
```

Add imports:

```ts
import {
  buildSourceArtifactObjectKey,
  storeUploadedWorkbook,
} from "@/server/storage/workbooks";
import { normalizeXeroInvoicesToParseResult } from "@/server/xero/normalizer";
```

- [ ] **Step 5: Write focused service tests**

Create `src/server/__tests__/xero-snapshot-pull.test.ts` with mocked Prisma,
storage, and a scoped analyst:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/server/storage/workbooks", async (actual) => {
  const mod = await actual<typeof import("@/server/storage/workbooks")>();
  return {
    ...mod,
    storeUploadedWorkbook: vi.fn().mockResolvedValue({
      stored: false,
      key: null,
      uri: "local-dev://xero-api-pull.json",
    }),
  };
});

import { getPrisma } from "@/lib/prisma";
import { createSnapshotFromXeroPull } from "@/server/snapshots/service";

describe("createSnapshotFromXeroPull", () => {
  it("creates a staged Xero snapshot and audit row", async () => {
    const tx = {
      snapshots: { create: vi.fn().mockResolvedValue({}) },
      audit_log: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi.fn().mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      snapshots: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as never);

    const response = await createSnapshotFromXeroPull({
      entityCode: "UAE",
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      currentUser: {
        id: "user-1",
        email: "analyst@emb.global",
        name: "Analyst",
        role: "ANALYST",
        entityIdScope: "entity-uae",
        isActive: true,
        lastLoginAt: null,
      },
      invoices: [
        {
          InvoiceID: "inv-1",
          InvoiceNumber: "INV-1",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "contact-1", Name: "Acme" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 10,
          CurrencyCode: "AED",
        },
      ],
    });

    expect(response.status).toBe("STAGED");
    expect(tx.snapshots.create).toHaveBeenCalled();
    expect(tx.audit_log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "snapshot.create_xero_api",
        }),
      }),
    );
  });
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test -- src/server/__tests__/workbook-storage.test.ts src/server/__tests__/xero-snapshot-pull.test.ts
npm run typecheck
```

Expected: PASS and zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/storage/workbooks.ts src/server/snapshots/service.ts src/server/__tests__/workbook-storage.test.ts src/server/__tests__/xero-snapshot-pull.test.ts
git commit -m "feat: stage snapshots from Xero API payloads"
```

---

### Task 6: Xero Connection Service And OAuth Routes

**Files:**
- Create: `src/server/xero/connections.ts`
- Create: `src/app/api/admin/xero/connect/route.ts`
- Create: `src/app/api/admin/xero/callback/route.ts`
- Create: `src/app/api/admin/xero/disconnect/route.ts`
- Test: `src/server/__tests__/xero-connections.test.ts`
- Test: `src/server/__tests__/xero-route-guards.test.ts`

- [ ] **Step 1: Write service tests**

Create `src/server/__tests__/xero-connections.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    XERO_CLIENT_ID: "client-id",
    XERO_CLIENT_SECRET: "client-secret",
    XERO_REDIRECT_URI: "http://localhost:3000/api/admin/xero/callback",
    XERO_OAUTH_SCOPES:
      "openid profile email offline_access accounting.transactions.read accounting.contacts.read",
    XERO_TOKEN_ENCRYPTION_KEY: "k".repeat(40),
  },
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/server/xero/client", () => ({
  buildXeroAuthorizationUrl: vi.fn(() => new URL("https://login.xero.com/auth")),
  exchangeCodeForTokens: vi.fn().mockResolvedValue({
    access_token: "access",
    refresh_token: "refresh",
    expires_in: 1800,
    token_type: "Bearer",
    scope: "openid accounting.transactions.read",
  }),
  listXeroTenants: vi.fn().mockResolvedValue([
    {
      tenantId: "tenant-1",
      tenantName: "Mantarav",
      tenantType: "ORGANISATION",
      id: "connection-1",
      createdDateUtc: "2026-05-16T00:00:00Z",
      updatedDateUtc: "2026-05-16T00:00:00Z",
    },
  ]),
}));

import { getPrisma } from "@/lib/prisma";
import {
  completeXeroConnection,
  startXeroConnection,
} from "@/server/xero/connections";

describe("xero connections", () => {
  it("builds a connect URL for admins", () => {
    const started = startXeroConnection("state-value");
    expect(started.toString()).toBe("https://login.xero.com/auth");
  });

  it("stores encrypted refresh token and audits connection", async () => {
    const tx = {
      xero_connections: {
        upsert: vi.fn().mockResolvedValue({ id: "connection-id" }),
      },
      audit_log: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi.fn().mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      $transaction: vi.fn(async (fn) => fn(tx)),
    } as never);

    const connection = await completeXeroConnection({
      code: "auth-code",
      entityCode: "UAE",
      currentUser: {
        id: "admin-1",
        email: "admin@emb.global",
        name: "Admin",
        role: "ADMIN",
        entityIdScope: null,
        isActive: true,
        lastLoginAt: null,
      },
    });

    expect(connection.tenant_id).toBe("tenant-1");
    expect(tx.xero_connections.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          encrypted_refresh_token: expect.stringMatching(/^v1\./),
        }),
      }),
    );
    expect(JSON.stringify(tx.xero_connections.upsert.mock.calls[0][0])).not.toContain(
      "refresh",
    );
  });
});
```

- [ ] **Step 2: Implement connection service**

Create `src/server/xero/connections.ts`:

```ts
import { Prisma } from "@/generated/prisma/client";
import { env } from "@/lib/env";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/secret-crypto";
import type { AuthenticatedUser } from "@/server/core/auth";
import { HttpError } from "@/server/core/errors";
import {
  buildXeroAuthorizationUrl,
  exchangeCodeForTokens,
  listXeroTenants,
} from "@/server/xero/client";

function requireXeroConfig() {
  if (
    !env.XERO_CLIENT_ID ||
    !env.XERO_CLIENT_SECRET ||
    !env.XERO_REDIRECT_URI ||
    !env.XERO_TOKEN_ENCRYPTION_KEY
  ) {
    throw new HttpError(
      "xero_not_configured",
      500,
      "Xero integration is not configured",
    );
  }
  return {
    clientId: env.XERO_CLIENT_ID,
    clientSecret: env.XERO_CLIENT_SECRET,
    redirectUri: env.XERO_REDIRECT_URI,
    scopes: env.XERO_OAUTH_SCOPES,
    tokenKey: env.XERO_TOKEN_ENCRYPTION_KEY,
  };
}

export function startXeroConnection(state: string): URL {
  const config = requireXeroConfig();
  return buildXeroAuthorizationUrl({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    state,
  });
}

export async function completeXeroConnection(input: {
  code: string;
  entityCode: "UAE";
  currentUser: AuthenticatedUser;
}) {
  const config = requireXeroConfig();
  const prisma = getPrisma();
  const entity = await prisma.entities.findUnique({
    where: { code: input.entityCode },
    select: { id: true, code: true },
  });
  if (!entity) {
    throw new HttpError("not_found", 404, "Entity not found");
  }

  const tokens = await exchangeCodeForTokens({
    code: input.code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
  const tenants = await listXeroTenants(tokens.access_token);
  const tenant = tenants.find((item) => item.tenantType === "ORGANISATION");
  if (!tenant) {
    throw new HttpError(
      "xero_tenant_missing",
      422,
      "No Xero organisation tenant was returned",
    );
  }

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  return prisma.$transaction(async (tx) => {
    const connection = await tx.xero_connections.upsert({
      where: {
        entity_id_tenant_id: {
          entity_id: entity.id,
          tenant_id: tenant.tenantId,
        },
      },
      update: {
        tenant_name: tenant.tenantName,
        scopes: (tokens.scope ?? config.scopes).split(/\s+/).filter(Boolean),
        encrypted_refresh_token: encryptSecret(
          tokens.refresh_token,
          config.tokenKey,
        ),
        access_token_expires_at: expiresAt,
        status: "ACTIVE",
        disconnected_at: null,
        updated_at: new Date(),
      },
      create: {
        id: createId(),
        entity_id: entity.id,
        tenant_id: tenant.tenantId,
        tenant_name: tenant.tenantName,
        scopes: (tokens.scope ?? config.scopes).split(/\s+/).filter(Boolean),
        encrypted_refresh_token: encryptSecret(
          tokens.refresh_token,
          config.tokenKey,
        ),
        access_token_expires_at: expiresAt,
        status: "ACTIVE",
        connected_by: input.currentUser.id,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: input.currentUser.id,
        action: "xero.connection.upsert",
        entity_type: "xero_connections",
        entity_id: connection.id,
        before: Prisma.JsonNull,
        after: {
          entity_code: entity.code,
          tenant_id: tenant.tenantId,
          tenant_name: tenant.tenantName,
          scopes: connection.scopes,
          status: connection.status,
        },
      },
    });

    return connection;
  });
}

export async function disconnectXeroConnection(input: {
  connectionId: string;
  currentUser: AuthenticatedUser;
}) {
  return getPrisma().$transaction(async (tx) => {
    const existing = await tx.xero_connections.findUnique({
      where: { id: input.connectionId },
    });
    if (!existing) {
      throw new HttpError("not_found", 404, "Xero connection not found");
    }
    const updated = await tx.xero_connections.update({
      where: { id: input.connectionId },
      data: {
        status: "DISCONNECTED",
        disconnected_at: new Date(),
        updated_at: new Date(),
      },
    });
    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: input.currentUser.id,
        action: "xero.connection.disconnect",
        entity_type: "xero_connections",
        entity_id: input.connectionId,
        before: {
          status: existing.status,
          disconnected_at: existing.disconnected_at,
        },
        after: {
          status: updated.status,
          disconnected_at: updated.disconnected_at?.toISOString() ?? null,
        },
      },
    });
    return updated;
  });
}
```

- [ ] **Step 3: Implement routes**

Create `src/app/api/admin/xero/connect/route.ts`:

```ts
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { startXeroConnection } from "@/server/xero/connections";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole(role_enum.ADMIN);
    const state = crypto.randomUUID();
    const url = startXeroConnection(state);
    const response = NextResponse.redirect(url);
    response.cookies.set("xero_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

Create `src/app/api/admin/xero/callback/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { completeXeroConnection } from "@/server/xero/connections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const cookieState = request.cookies.get("xero_oauth_state")?.value;
    if (!state || !cookieState || state !== cookieState) {
      throw new HttpError("invalid_oauth_state", 400, "Invalid Xero OAuth state");
    }
    if (!code) {
      throw new HttpError("missing_oauth_code", 400, "Missing Xero OAuth code");
    }
    await completeXeroConnection({
      code,
      entityCode: "UAE",
      currentUser,
    });
    const response = NextResponse.redirect(new URL("/admin/xero", request.url));
    response.cookies.set("xero_oauth_state", "", { path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

Create `src/app/api/admin/xero/disconnect/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { disconnectXeroConnection } from "@/server/xero/connections";

export const dynamic = "force-dynamic";

const schema = z.object({ connection_id: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const body = schema.parse(await request.json());
    const row = await disconnectXeroConnection({
      connectionId: body.connection_id,
      currentUser,
    });
    return NextResponse.json({ id: row.id, status: row.status });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 4: Add route guard structural tests**

Create `src/server/__tests__/xero-route-guards.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("xero route guards", () => {
  it("keeps connection management admin-only", () => {
    for (const file of [
      "src/app/api/admin/xero/connect/route.ts",
      "src/app/api/admin/xero/callback/route.ts",
      "src/app/api/admin/xero/disconnect/route.ts",
    ]) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).toContain("requireRole(role_enum.ADMIN");
    }
  });

  it("does not expose CFO or PENDING in Xero mutation routes", () => {
    const files = [
      "src/app/api/admin/xero/connect/route.ts",
      "src/app/api/admin/xero/callback/route.ts",
      "src/app/api/admin/xero/disconnect/route.ts",
    ];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      expect(source).not.toContain("role_enum.CFO");
      expect(source).not.toContain("role_enum.PENDING");
    }
  });
});
```

- [ ] **Step 5: Run tests and checks**

Run:

```bash
npm test -- src/server/__tests__/xero-connections.test.ts src/server/__tests__/xero-route-guards.test.ts
npm run typecheck
```

Expected: PASS and zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/xero/connections.ts src/app/api/admin/xero/connect/route.ts src/app/api/admin/xero/callback/route.ts src/app/api/admin/xero/disconnect/route.ts src/server/__tests__/xero-connections.test.ts src/server/__tests__/xero-route-guards.test.ts
git commit -m "feat: add Xero OAuth connection flow"
```

---

### Task 7: Pull Endpoint And Sync Run Tracking

**Files:**
- Modify: `src/server/xero/connections.ts`
- Modify: `src/server/snapshots/service.ts`
- Create: `src/app/api/xero/snapshots/pull/route.ts`
- Test: `src/server/__tests__/xero-snapshot-pull.test.ts`

- [ ] **Step 1: Add connection token refresh helper**

Extend `src/server/xero/connections.ts`:

```ts
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";
import { refreshAccessToken } from "@/server/xero/client";

export async function refreshConnectionAccess(input: {
  connectionId: string;
}) {
  const config = requireXeroConfig();
  const prisma = getPrisma();
  const connection = await prisma.xero_connections.findUnique({
    where: { id: input.connectionId },
  });
  if (!connection || connection.status !== "ACTIVE") {
    throw new HttpError("xero_connection_inactive", 422, "Xero connection is inactive");
  }

  const refreshToken = decryptSecret(
    connection.encrypted_refresh_token,
    config.tokenKey,
  );
  const tokens = await refreshAccessToken({
    refreshToken,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
  });

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  const updated = await prisma.xero_connections.update({
    where: { id: connection.id },
    data: {
      encrypted_refresh_token: encryptSecret(tokens.refresh_token, config.tokenKey),
      access_token_expires_at: expiresAt,
      updated_at: new Date(),
    },
  });

  return {
    connection: updated,
    accessToken: tokens.access_token,
  };
}
```

- [ ] **Step 2: Fetch all open Xero invoices**

Create or extend a helper in `src/server/xero/client.ts`:

```ts
import type { XeroInvoicesResponse, XeroInvoice } from "@/server/xero/types";

export async function fetchOpenReceivableInvoices(input: {
  accessToken: string;
  tenantId: string;
}): Promise<{ invoices: XeroInvoice[]; pagesFetched: number }> {
  const invoices: XeroInvoice[] = [];
  let page = 1;

  while (true) {
    const response = await fetchXeroJson<XeroInvoicesResponse>({
      accessToken: input.accessToken,
      tenantId: input.tenantId,
      path: "/Invoices",
      searchParams: {
        page: String(page),
        where: 'Type=="ACCREC"&&AmountDue>0',
        order: "Date ASC",
      },
    });
    const batch = response.Invoices ?? [];
    invoices.push(...batch);
    if (batch.length < 100) {
      break;
    }
    page += 1;
  }

  return { invoices, pagesFetched: page };
}
```

- [ ] **Step 3: Add sync run orchestration**

In `src/server/snapshots/service.ts`, add a route-facing service:

```ts
export async function pullXeroSnapshot(params: {
  currentUser: AuthenticatedUser;
  connectionId?: string;
}): Promise<SnapshotCreateResponse & { sync_run_id: string }> {
  const prisma = getPrisma();
  const connection = params.connectionId
    ? await prisma.xero_connections.findUnique({
        where: { id: params.connectionId },
        include: { entities: { select: { code: true, id: true } } },
      })
    : await prisma.xero_connections.findFirst({
        where: { status: "ACTIVE", entities: { code: "UAE" } },
        include: { entities: { select: { code: true, id: true } } },
      });

  if (!connection || connection.status !== "ACTIVE") {
    throw new HttpError("xero_connection_missing", 422, "Active Xero connection not found");
  }
  await assertAnalystCanAccessEntity(params.currentUser, connection.entity_id);

  const syncRunId = createId();
  await prisma.xero_sync_runs.create({
    data: {
      id: syncRunId,
      connection_id: connection.id,
      triggered_by: params.currentUser.id,
      status: "RUNNING",
    },
  });

  try {
    const { accessToken } = await refreshConnectionAccess({
      connectionId: connection.id,
    });
    const fetched = await fetchOpenReceivableInvoices({
      accessToken,
      tenantId: connection.tenant_id,
    });
    const snapshot = await createSnapshotFromXeroPull({
      entityCode: "UAE",
      invoices: fetched.invoices,
      currentUser: params.currentUser,
    });
    await prisma.xero_sync_runs.update({
      where: { id: syncRunId },
      data: {
        status: "SUCCEEDED",
        finished_at: new Date(),
        snapshot_id: snapshot.snapshot_id,
        pages_fetched: fetched.pagesFetched,
        invoices_seen: fetched.invoices.length,
        invoices_staged: snapshot.row_count,
        parse_errors: snapshot.errors_count,
        source_artifact_sha256: snapshot.file_sha256,
      },
    });
    return { ...snapshot, sync_run_id: syncRunId };
  } catch (error) {
    await prisma.xero_sync_runs.update({
      where: { id: syncRunId },
      data: {
        status: "FAILED",
        finished_at: new Date(),
        error_code:
          error instanceof HttpError ? error.code : "xero_sync_failed",
        error_message: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
```

Add imports:

```ts
import { fetchOpenReceivableInvoices } from "@/server/xero/client";
import { refreshConnectionAccess } from "@/server/xero/connections";
```

- [ ] **Step 4: Add pull route**

Create `src/app/api/xero/snapshots/pull/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { pullXeroSnapshot } from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  connection_id: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const body = schema.parse(await request.json().catch(() => ({})));
    const response = await pullXeroSnapshot({
      currentUser,
      connectionId: body.connection_id,
    });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 5: Extend sync tests**

Extend `src/server/__tests__/xero-route-guards.test.ts` so the pull route is
covered after the file exists:

```ts
it("keeps Xero pulls limited to analyst and admin", () => {
  const source = readFileSync(
    join(root, "src/app/api/xero/snapshots/pull/route.ts"),
    "utf8",
  );
  expect(source).toContain("requireRole(role_enum.ANALYST, role_enum.ADMIN)");
  expect(source).not.toContain("role_enum.CFO");
  expect(source).not.toContain("role_enum.PENDING");
});
```

Extend `src/server/__tests__/xero-snapshot-pull.test.ts` with cases for:

```ts
it("marks sync run FAILED when Xero fetch fails", async () => {
  // Mock refreshConnectionAccess to return a token.
  // Mock fetchOpenReceivableInvoices to throw new Error("Xero unavailable").
  // Assert xero_sync_runs.update receives status: "FAILED".
});

it("rejects analyst pulls outside their entity scope", async () => {
  // Mock active UAE connection.
  // Use currentUser.entityIdScope = "other-entity".
  // Expect ForbiddenError message "Analyst cannot access this entity".
});
```

Use full mocked implementations, not live Xero calls.

- [ ] **Step 6: Run tests and checks**

Run:

```bash
npm test -- src/server/__tests__/xero-snapshot-pull.test.ts src/server/__tests__/xero-client.test.ts
npm run typecheck
```

Expected: PASS and zero TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/server/xero/connections.ts src/server/xero/client.ts src/server/snapshots/service.ts src/app/api/xero/snapshots/pull/route.ts src/server/__tests__/xero-snapshot-pull.test.ts
git commit -m "feat: pull staged snapshots from Xero"
```

---

### Task 8: Minimal Admin And Upload UI

**Files:**
- Create: `src/app/admin/xero/page.tsx`
- Create: `src/app/admin/xero/_components/disconnect-xero-button.tsx`
- Modify: `src/app/upload/_components/upload-snapshot-form.tsx`
- Test: `src/server/__tests__/xero-admin-ui.test.ts`

- [ ] **Step 1: Write structural UI tests**

Create `src/server/__tests__/xero-admin-ui.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("xero admin UI", () => {
  it("ships an admin page with connect and disconnect actions", () => {
    const source = readFileSync(join(root, "src/app/admin/xero/page.tsx"), "utf8");
    expect(source).toContain("/api/admin/xero/connect");
    expect(source).toContain("DisconnectXeroButton");
    expect(source).toContain("Xero connection");
  });

  it("disconnect button posts JSON to the route", () => {
    const source = readFileSync(
      join(root, "src/app/admin/xero/_components/disconnect-xero-button.tsx"),
      "utf8",
    );
    expect(source).toContain("/api/admin/xero/disconnect");
    expect(source).toContain("JSON.stringify({ connection_id: connectionId })");
  });

  it("adds a pull action to the upload form without removing manual upload", () => {
    const source = readFileSync(
      join(root, "src/app/upload/_components/upload-snapshot-form.tsx"),
      "utf8",
    );
    expect(source).toContain("/api/xero/snapshots/pull");
    expect(source).toContain("Pull from Xero");
    expect(source).toContain("type=\"file\"");
  });
});
```

- [ ] **Step 2: Add admin page**

Create `src/app/admin/xero/page.tsx`:

```tsx
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  EmptyState,
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
} from "@/components/ui/workspace";
import { StatusTag } from "@/components/ui/status-tag";
import { role_enum } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { getPrisma } from "@/lib/prisma";
import { requirePageRole } from "@/server/core/page-auth";
import { DisconnectXeroButton } from "./_components/disconnect-xero-button";

export const dynamic = "force-dynamic";

export default async function XeroAdminPage() {
  await requirePageRole("/admin/xero", role_enum.ADMIN);

  const connections = await getPrisma().xero_connections.findMany({
    where: { entities: { code: "UAE" } },
    orderBy: { updated_at: "desc" },
    take: 10,
  });

  return (
    <PageFrame>
      <PageHeader
        eyebrow={
          <Link
            className="inline-flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            href="/admin"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Admin
          </Link>
        }
        title="Xero connection"
      >
        Read-only UAE source connection for staged receivables snapshots.
      </PageHeader>

      <Panel>
        <PanelHeader title="Connection">
          Connect Xero with read-only OAuth scopes. Receivables OS still owns
          ageing, credit days, staging, publish, and audit.
        </PanelHeader>
        <div className="flex justify-end border-b border-[var(--color-border)] p-4">
        <a
          className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] px-3 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]"
          href="/api/admin/xero/connect"
        >
          Connect Xero
        </a>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium text-[var(--color-text-muted)]">
            <tr>
              <th className="px-4 py-3">Tenant</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Updated</th>
              <th className="px-4 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {connections.map((connection) => (
              <tr key={connection.id}>
                <td className="px-4 py-3 font-medium">
                  {connection.tenant_name}
                </td>
                <td className="px-4 py-3">
                  <StatusTag
                    label={connection.status}
                    status={
                      connection.status === "ACTIVE" ? "GATE_OK" : "READ_ONLY"
                    }
                  />
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-muted)]">
                  {formatDateTime(connection.updated_at)}
                </td>
                <td className="px-4 py-3 text-right">
                  <DisconnectXeroButton connectionId={connection.id} />
                </td>
              </tr>
            ))}
            {connections.length === 0 ? (
              <tr>
                <td className="px-4 py-8" colSpan={4}>
                  <EmptyState
                    description="Connect Xero before analysts can pull UAE snapshots directly."
                    title="No Xero connection configured"
                  />
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </PageFrame>
  );
}
```

- [ ] **Step 3: Add disconnect button**

Create `src/app/admin/xero/_components/disconnect-xero-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DisconnectXeroButton({ connectionId }: { connectionId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");

  async function disconnect() {
    setStatus("submitting");
    const response = await fetch("/api/admin/xero/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connection_id: connectionId }),
    });
    if (!response.ok) {
      setStatus("error");
      return;
    }
    setStatus("idle");
    router.refresh();
  }

  return (
    <button
      className="rounded-md border border-[var(--color-border)] px-2 py-1 text-xs hover:bg-[var(--color-bg-subtle)] disabled:pointer-events-none disabled:opacity-60"
      disabled={status === "submitting"}
      onClick={disconnect}
      type="button"
    >
      {status === "submitting"
        ? "Disconnecting..."
        : status === "error"
          ? "Retry disconnect"
          : "Disconnect"}
    </button>
  );
}
```

- [ ] **Step 4: Add upload-form pull action**

In `src/app/upload/_components/upload-snapshot-form.tsx`, add a small UAE-only
button near the manual upload submit:

```tsx
const [xeroPullStatus, setXeroPullStatus] = useState<UploadStatus>("idle");

async function pullFromXero() {
  setXeroPullStatus("submitting");
  setMessage("");
  const response = await fetch("/api/xero/snapshots/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const payload = (await response.json().catch(() => null)) as
    | { snapshot_id?: string; message?: string; error?: { message?: string } }
    | null;

  if (!response.ok || !payload?.snapshot_id) {
    setXeroPullStatus("error");
    setMessage(
      payload?.message ??
        payload?.error?.message ??
        "Xero pull failed. Check the connection and try again.",
    );
    return;
  }
  router.push(`/snapshots/${payload.snapshot_id}/staging`);
  router.refresh();
}
```

Render this inside the UI v2 button row after the upload button:

```tsx
{entityCode === "UAE" ? (
  <DsButton
    type="button"
    disabled={status === "submitting" || xeroPullStatus === "submitting"}
    loading={xeroPullStatus === "submitting"}
    onClick={pullFromXero}
  >
    {xeroPullStatus === "submitting" ? "Pulling from Xero..." : "Pull from Xero"}
  </DsButton>
) : null}
```

Render this after the classic upload button in the non-UI-v2 branch:

```tsx
{entityCode === "UAE" ? (
  <button
    className="w-fit rounded border border-[var(--color-border)] px-4 py-2 transition-colors hover:bg-[var(--color-bg-subtle)] disabled:pointer-events-none disabled:opacity-60"
    disabled={status === "submitting" || xeroPullStatus === "submitting"}
    onClick={pullFromXero}
    type="button"
  >
    {xeroPullStatus === "submitting" ? "Pulling from Xero..." : "Pull from Xero"}
  </button>
) : null}
```

In the classic entity `<select>`, make the controlled state match UI v2:

```tsx
<select
  className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
  disabled={status === "submitting"}
  name="entity_code"
  onChange={(event) => setEntityCode(event.target.value)}
  required
  value={entityCode}
>
```

- [ ] **Step 5: Run UI structural test**

Run:

```bash
npm test -- src/server/__tests__/xero-admin-ui.test.ts
npm run typecheck
```

Expected: PASS and zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/admin/xero/page.tsx src/app/admin/xero/_components/disconnect-xero-button.tsx src/app/upload/_components/upload-snapshot-form.tsx src/server/__tests__/xero-admin-ui.test.ts
git commit -m "feat: expose Xero pull controls"
```

---

### Task 9: Final Verification And UAT Checklist

**Files:**
- Modify: `README.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Update README configuration notes**

Add a short "Xero API ingestion" section to `README.md`:

```md
## Xero API Ingestion

The UAE entity can create staged snapshots from a read-only Xero OAuth
connection. Xero supplies source invoices and contacts; Receivables OS still
computes ageing from snapshot `as_of_date` and EMB credit days.

Required environment variables when enabled:

- `XERO_CLIENT_ID`
- `XERO_CLIENT_SECRET`
- `XERO_REDIRECT_URI`
- `XERO_OAUTH_SCOPES`
- `XERO_TOKEN_ENCRYPTION_KEY`

Normal tests use fixture JSON and do not require live Xero credentials.
```

- [ ] **Step 2: Update PROGRESS**

Add a bullet under implemented surface after snapshot upload:

```md
- **Read-only Xero API ingestion plan/implementation** - UAE snapshots can be staged from Xero source invoices through OAuth, encrypted refresh tokens, sync-run audit records, and the existing staging/publish pipeline.
```

- [ ] **Step 3: Run complete local verification**

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Expected:

```text
npm run typecheck   # zero errors
npm run lint        # zero errors/warnings
npm test            # all tests pass
npm run build       # Next build completes
```

If `npm run build` fails on Prisma engine download or a local dev server file
lock, record the exact failure in the final handoff and rerun after the
environment blocker is cleared.

- [ ] **Step 4: Manual demo-company UAT**

With a Xero demo company connected through `/admin/xero`:

```text
1. ADMIN connects Xero.
2. ANALYST with UAE scope clicks Pull from Xero.
3. App creates a STAGED Xero snapshot and redirects to staging.
4. Staging rows show OK/PARSE_ERROR without silently dropping rows.
5. Publish gate still blocks unresolved aliases, parse errors, missing credit days, and review requirements.
6. Published invoice ageing uses EMB credit days, not Xero due dates.
7. Audit log contains xero.connection.upsert, snapshot.create_xero_api, and any follow-up mutation rows.
```

- [ ] **Step 5: Commit docs**

```bash
git add README.md PROGRESS.md
git commit -m "docs: document Xero API ingestion"
```

---

## Self-Review Checklist

- ADR-0012 coverage:
  - Read-only connector: Tasks 3, 6, 7.
  - OAuth 2.0 and encrypted tokens: Tasks 2, 3, 6.
  - Existing staging/publish pipeline reuse: Tasks 4, 5, 7.
  - No Xero due-date ageing: Task 4 test.
  - RBAC and audit: Tasks 5, 6, 7.
  - No live credentials in tests: Tasks 3, 4, 6, 7.
  - Vercel env variables: Tasks 1 and 9.
- Scope boundaries:
  - No Xero write-back endpoints are introduced.
  - Historical backfill is not implemented.
  - Manual workbook upload remains available.
  - `source_hint` remains `"XERO"`; origin is carried in parse/audit metadata.
- Final verification:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - `npm run build`

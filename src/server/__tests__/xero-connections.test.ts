import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    XERO_CLIENT_ID: "client-id",
    XERO_CLIENT_SECRET: "client-secret",
    XERO_REDIRECT_URI: "http://localhost:3000/api/admin/xero/callback",
    XERO_OAUTH_SCOPES:
      "openid profile email offline_access accounting.invoices.read accounting.contacts.read",
    XERO_TOKEN_ENCRYPTION_KEY: "k".repeat(40),
  },
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/server/xero/client", () => ({
  buildXeroAuthorizationUrl: vi.fn(
    () => new URL("https://login.xero.com/auth?state=s"),
  ),
  exchangeCodeForTokens: vi.fn().mockResolvedValue({
    access_token: "access",
    refresh_token: "refresh-token-value",
    expires_in: 1800,
    token_type: "Bearer",
    scope: "openid accounting.invoices.read",
  }),
  refreshAccessToken: vi.fn().mockResolvedValue({
    access_token: "new-access",
    refresh_token: "new-refresh-token",
    expires_in: 1800,
    token_type: "Bearer",
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
  disconnectXeroConnection,
  refreshConnectionAccess,
  startXeroConnection,
} from "@/server/xero/connections";

const admin = {
  id: "admin-1",
  email: "admin@emb.global",
  name: "Admin",
  role: "ADMIN" as const,
  entityIdScope: null,
  isActive: true,
  lastLoginAt: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("xero connections", () => {
  it("builds an authorization URL", () => {
    const url = startXeroConnection("state-value");
    expect(url.toString()).toContain("https://login.xero.com/auth");
  });

  it("upserts a connection with an encrypted refresh token and audits", async () => {
    const tx: {
      xero_connections: { upsert: ReturnType<typeof vi.fn> };
      audit_log: { create: ReturnType<typeof vi.fn> };
    } = {
      xero_connections: {
        upsert: vi.fn().mockResolvedValue({
          id: "connection-id",
          tenant_id: "tenant-1",
          scopes: ["openid", "accounting.invoices.read"],
          status: "ACTIVE",
        }),
      },
      audit_log: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    } as never);

    const result = await completeXeroConnection({
      code: "auth-code",
      entityCode: "UAE",
      currentUser: admin,
    });

    expect(result.tenant_id).toBe("tenant-1");
    expect(tx.xero_connections.upsert).toHaveBeenCalledOnce();
    const upsertArgs = tx.xero_connections.upsert.mock.calls[0][0] as {
      create: { encrypted_refresh_token: string };
    };
    expect(upsertArgs.create.encrypted_refresh_token).toMatch(/^v1\./);
    // The raw refresh token must never appear in any persisted field.
    expect(JSON.stringify(upsertArgs)).not.toContain("refresh-token-value");
    expect(tx.audit_log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "xero.connection.upsert" }),
      }),
    );
  });

  it("marks a connection DISCONNECTED and audits with before/after", async () => {
    const tx: {
      xero_connections: {
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
      audit_log: { create: ReturnType<typeof vi.fn> };
    } = {
      xero_connections: {
        findUnique: vi.fn().mockResolvedValue({
          id: "c1",
          status: "ACTIVE",
          disconnected_at: null,
        }),
        update: vi.fn().mockResolvedValue({
          id: "c1",
          status: "DISCONNECTED",
          disconnected_at: new Date("2026-05-16T00:00:00.000Z"),
        }),
      },
      audit_log: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(getPrisma).mockReturnValue({
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(tx),
      ),
    } as never);

    const result = await disconnectXeroConnection({
      connectionId: "c1",
      currentUser: admin,
    });

    expect(result.status).toBe("DISCONNECTED");
    expect(tx.audit_log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "xero.connection.disconnect",
          before: expect.objectContaining({ status: "ACTIVE" }),
          after: expect.objectContaining({ status: "DISCONNECTED" }),
        }),
      }),
    );
  });

  it("rotates refresh token on refreshConnectionAccess and never logs it", async () => {
    // Persist an encrypted refresh token first by encrypting "stored-refresh"
    // with the same test key so the function can decrypt it.
    const { encryptSecret } = await import("@/lib/secret-crypto");
    const stored = encryptSecret("stored-refresh", "k".repeat(40));
    const updateMock = vi.fn().mockResolvedValue({
      id: "c1",
      tenant_id: "tenant-1",
      entity_id: "entity-uae",
      status: "ACTIVE",
    });
    vi.mocked(getPrisma).mockReturnValue({
      xero_connections: {
        findUnique: vi.fn().mockResolvedValue({
          id: "c1",
          status: "ACTIVE",
          encrypted_refresh_token: stored,
        }),
        update: updateMock,
      },
    } as never);

    const result = await refreshConnectionAccess({ connectionId: "c1" });

    expect(result.accessToken).toBe("new-access");
    const updateArgs = updateMock.mock.calls[0][0] as {
      data: { encrypted_refresh_token: string };
    };
    expect(updateArgs.data.encrypted_refresh_token).toMatch(/^v1\./);
    expect(JSON.stringify(updateArgs)).not.toContain("new-refresh-token");
  });

  it("rejects refresh on a disconnected connection", async () => {
    vi.mocked(getPrisma).mockReturnValue({
      xero_connections: {
        findUnique: vi.fn().mockResolvedValue({
          id: "c1",
          status: "DISCONNECTED",
          encrypted_refresh_token: "v1.dead",
        }),
      },
    } as never);

    await expect(
      refreshConnectionAccess({ connectionId: "c1" }),
    ).rejects.toMatchObject({
      code: "xero_connection_inactive",
      status: 422,
    });
  });
});

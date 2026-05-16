import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ getPrisma: vi.fn() }));
vi.mock("@/server/storage/workbooks", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/storage/workbooks")>();
  return {
    ...mod,
    storeUploadedWorkbook: vi.fn().mockResolvedValue({
      stored: false,
      key: null,
      uri: "local-dev://xero-api-pull.json",
    }),
  };
});
vi.mock("@/server/xero/connections", () => ({
  refreshConnectionAccess: vi.fn(),
}));
vi.mock("@/server/xero/client", () => ({
  fetchOpenReceivableInvoices: vi.fn(),
}));

import { getPrisma } from "@/lib/prisma";
import { ForbiddenError } from "@/server/core/errors";
import { pullXeroSnapshot } from "@/server/snapshots/service";
import { fetchOpenReceivableInvoices } from "@/server/xero/client";
import { refreshConnectionAccess } from "@/server/xero/connections";

const analyst = {
  id: "user-1",
  email: "analyst@emb.global",
  name: "Analyst",
  role: "ANALYST" as const,
  entityIdScope: "entity-uae",
  isActive: true,
  lastLoginAt: null,
};

const activeUaeConnection = {
  id: "conn-1",
  tenant_id: "tenant-1",
  entity_id: "entity-uae",
  status: "ACTIVE",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("pullXeroSnapshot", () => {
  it("marks the sync run SUCCEEDED on a happy-path pull", async () => {
    const syncRunUpdate = vi.fn().mockResolvedValue({});
    const snapshotsCreate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});

    vi.mocked(getPrisma).mockReturnValue({
      xero_connections: {
        findFirst: vi.fn().mockResolvedValue(activeUaeConnection),
      },
      xero_sync_runs: {
        create: vi.fn().mockResolvedValue({}),
        update: syncRunUpdate,
      },
      entities: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      snapshots: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(
        async (
          fn: (tx: {
            snapshots: { create: typeof snapshotsCreate };
            audit_log: { create: typeof auditCreate };
          }) => Promise<unknown>,
        ) =>
          fn({
            snapshots: { create: snapshotsCreate },
            audit_log: { create: auditCreate },
          }),
      ),
    } as never);
    vi.mocked(refreshConnectionAccess).mockResolvedValue({
      connection: activeUaeConnection,
      accessToken: "access",
    });
    vi.mocked(fetchOpenReceivableInvoices).mockResolvedValue({
      invoices: [
        {
          InvoiceID: "inv-1",
          InvoiceNumber: "INV-1",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "c-1", Name: "Acme" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 100,
          CurrencyCode: "AED",
        },
      ],
      pagesFetched: 1,
    });

    const result = await pullXeroSnapshot({ currentUser: analyst });

    expect(result.status).toBe("STAGED");
    expect(result.sync_run_id).toBeDefined();
    expect(syncRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SUCCEEDED",
          pages_fetched: 1,
          invoices_seen: 1,
          invoices_staged: 1,
        }),
      }),
    );
  });

  it("marks the sync run FAILED when the Xero fetch throws", async () => {
    const syncRunUpdate = vi.fn().mockResolvedValue({});
    vi.mocked(getPrisma).mockReturnValue({
      xero_connections: {
        findFirst: vi.fn().mockResolvedValue(activeUaeConnection),
      },
      xero_sync_runs: {
        create: vi.fn().mockResolvedValue({}),
        update: syncRunUpdate,
      },
    } as never);
    vi.mocked(refreshConnectionAccess).mockResolvedValue({
      connection: activeUaeConnection,
      accessToken: "access",
    });
    vi.mocked(fetchOpenReceivableInvoices).mockRejectedValue(
      new Error("Xero unavailable"),
    );

    await expect(pullXeroSnapshot({ currentUser: analyst })).rejects.toThrow(
      "Xero unavailable",
    );

    expect(syncRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          error_code: "xero_sync_failed",
          error_message: "Xero unavailable",
        }),
      }),
    );
  });

  it("rejects analyst pulls outside the connection's entity scope", async () => {
    vi.mocked(getPrisma).mockReturnValue({
      xero_connections: {
        findFirst: vi.fn().mockResolvedValue(activeUaeConnection),
      },
      xero_sync_runs: { create: vi.fn().mockResolvedValue({}) },
    } as never);

    await expect(
      pullXeroSnapshot({
        currentUser: { ...analyst, entityIdScope: "entity-other" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns 422 when no active UAE connection exists", async () => {
    vi.mocked(getPrisma).mockReturnValue({
      xero_connections: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(
      pullXeroSnapshot({ currentUser: analyst }),
    ).rejects.toMatchObject({
      code: "xero_connection_missing",
      status: 422,
    });
  });
});

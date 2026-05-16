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

import { getPrisma } from "@/lib/prisma";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { createSnapshotFromXeroPull } from "@/server/snapshots/service";
import type { XeroInvoice } from "@/server/xero/types";

const okInvoice: XeroInvoice = {
  InvoiceID: "inv-1",
  InvoiceNumber: "INV-1",
  Type: "ACCREC",
  Status: "AUTHORISED",
  Contact: { ContactID: "contact-1", Name: "Acme LLC" },
  DateString: "2026-05-01T00:00:00",
  AmountDue: 10,
  CurrencyCode: "AED",
};

const analyst = {
  id: "user-1",
  email: "analyst@emb.global",
  name: "Analyst",
  role: "ANALYST" as const,
  entityIdScope: "entity-uae",
  isActive: true,
  lastLoginAt: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("createSnapshotFromXeroPull", () => {
  it("creates a staged Xero snapshot and writes an audit row marked XERO_API", async () => {
    const tx: {
      snapshots: { create: ReturnType<typeof vi.fn> };
      audit_log: { create: ReturnType<typeof vi.fn> };
    } = {
      snapshots: { create: vi.fn().mockResolvedValue({}) },
      audit_log: { create: vi.fn().mockResolvedValue({}) },
    };
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      snapshots: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn(tx),
      ),
    } as never);

    const response = await createSnapshotFromXeroPull({
      entityCode: "UAE",
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      currentUser: analyst,
      invoices: [okInvoice],
    });

    expect(response.status).toBe("STAGED");
    expect(response.entity_code).toBe("UAE");
    expect(response.source_hint).toBe("XERO");
    expect(response.row_count).toBe(1);
    expect(tx.snapshots.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_hint: "XERO",
          status: "STAGED",
          row_count: 1,
        }),
      }),
    );
    expect(tx.audit_log.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "snapshot.create_xero_api",
          after: expect.objectContaining({ source_origin: "XERO_API" }),
        }),
      }),
    );
  });

  it("rejects a duplicate Xero pull with HttpError 409", async () => {
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      snapshots: {
        findUnique: vi.fn().mockResolvedValue({ id: "prior-snap" }),
      },
    } as never);

    await expect(
      createSnapshotFromXeroPull({
        entityCode: "UAE",
        pulledAt: new Date("2026-05-16T00:00:00.000Z"),
        currentUser: analyst,
        invoices: [okInvoice],
      }),
    ).rejects.toMatchObject({
      code: "duplicate_snapshot",
      status: 409,
    });
  });

  it("rejects analyst pulls outside their entity scope", async () => {
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
    } as never);

    await expect(
      createSnapshotFromXeroPull({
        entityCode: "UAE",
        pulledAt: new Date("2026-05-16T00:00:00.000Z"),
        currentUser: { ...analyst, entityIdScope: "entity-other" },
        invoices: [okInvoice],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("returns 404 when the entity is missing", async () => {
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as never);

    await expect(
      createSnapshotFromXeroPull({
        entityCode: "UAE",
        pulledAt: new Date("2026-05-16T00:00:00.000Z"),
        currentUser: analyst,
        invoices: [okInvoice],
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });
});

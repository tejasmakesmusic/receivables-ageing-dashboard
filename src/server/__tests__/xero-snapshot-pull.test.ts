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

  it("dedupes regardless of pulledAt — same invoices at different times collide on the same sha256", async () => {
    // Capture every sha256 that hits snapshots.findUnique so we can prove
    // two calls with different `pulledAt` produce the same dedup hash.
    // Regression for the 2026-05-16 bug where pulled_at was baked into
    // the hashed payload and dedup never fired in production.
    const capturedHashes: string[] = [];
    const findUnique = vi.fn(
      async (args: { where: { upload_file_sha256: string } }) => {
        capturedHashes.push(args.where.upload_file_sha256);
        return null;
      },
    );
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      snapshots: { findUnique },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          snapshots: { create: vi.fn().mockResolvedValue({}) },
          audit_log: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as never);

    await createSnapshotFromXeroPull({
      entityCode: "UAE",
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      currentUser: analyst,
      invoices: [okInvoice],
    });
    await createSnapshotFromXeroPull({
      entityCode: "UAE",
      pulledAt: new Date("2026-05-17T12:34:56.000Z"), // different timestamp
      currentUser: analyst,
      invoices: [okInvoice], // identical invoices
    });

    expect(capturedHashes).toHaveLength(2);
    expect(capturedHashes[0]).toBe(capturedHashes[1]);
  });

  it("dedupes regardless of invoice array order — same set in different order collides", async () => {
    const otherInvoice: XeroInvoice = {
      ...okInvoice,
      InvoiceID: "inv-2",
      InvoiceNumber: "INV-2",
    };
    const capturedHashes: string[] = [];
    const findUnique = vi.fn(
      async (args: { where: { upload_file_sha256: string } }) => {
        capturedHashes.push(args.where.upload_file_sha256);
        return null;
      },
    );
    vi.mocked(getPrisma).mockReturnValue({
      entities: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: "entity-uae", code: "UAE" }),
      },
      snapshots: { findUnique },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) =>
        fn({
          snapshots: { create: vi.fn().mockResolvedValue({}) },
          audit_log: { create: vi.fn().mockResolvedValue({}) },
        }),
      ),
    } as never);

    await createSnapshotFromXeroPull({
      entityCode: "UAE",
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      currentUser: analyst,
      invoices: [okInvoice, otherInvoice],
    });
    await createSnapshotFromXeroPull({
      entityCode: "UAE",
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      currentUser: analyst,
      invoices: [otherInvoice, okInvoice], // reversed
    });

    expect(capturedHashes).toHaveLength(2);
    expect(capturedHashes[0]).toBe(capturedHashes[1]);
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

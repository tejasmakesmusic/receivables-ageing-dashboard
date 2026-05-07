import { beforeEach, describe, expect, it, vi } from "vitest";
import { role_enum } from "@/generated/prisma/enums";
import type { AuthenticatedUser } from "@/server/core/auth";

const prismaMock = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: prismaMock.getPrisma,
}));

const RESET_TABLES = [
  "email_outbox",
  "digest_events",
  "promises_to_pay",
  "dispute_cases",
  "follow_ups",
  "exception_tags",
  "collection_tasks",
  "invoice_snapshots",
  "invoices",
  "reconciliation_entries",
  "snapshots",
] as const;

type ResetTable = (typeof RESET_TABLES)[number];

function makeUser(role: role_enum): AuthenticatedUser {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "admin@emb.global",
    name: "Admin",
    role,
    entityIdScope: null,
    isActive: true,
    lastLoginAt: null,
  };
}

function makePrisma(counts: Partial<Record<ResetTable, number>> = {}) {
  const deleteOrder: string[] = [];
  const prisma = {
    audit_log: {
      create: vi.fn().mockResolvedValue({ id: "audit-id" }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn(prisma),
    ),
    __deleteOrder: deleteOrder,
  } as Record<string, unknown> & {
    __deleteOrder: string[];
    audit_log: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };

  for (const table of RESET_TABLES) {
    const count = counts[table] ?? 0;
    prisma[table] = {
      count: vi.fn().mockResolvedValue(count),
      deleteMany: vi.fn().mockImplementation(async () => {
        deleteOrder.push(table);
        return { count };
      }),
    };
  }

  return prisma;
}

describe("admin imported data reset", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaMock.getPrisma.mockReset();
  });

  it("requires ADMIN role", async () => {
    const prisma = makePrisma();
    prismaMock.getPrisma.mockReturnValue(prisma);
    const { DATA_RESET_CONFIRMATION_PHRASE, resetImportedReceivablesData } =
      await import("@/server/admin/dataReset");

    await expect(
      resetImportedReceivablesData(
        { confirmation: DATA_RESET_CONFIRMATION_PHRASE },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    expect(prismaMock.getPrisma).not.toHaveBeenCalled();
  });

  it("rejects requests without the exact confirmation phrase", async () => {
    const prisma = makePrisma();
    prismaMock.getPrisma.mockReturnValue(prisma);
    const { resetImportedReceivablesData } = await import(
      "@/server/admin/dataReset"
    );

    await expect(
      resetImportedReceivablesData(
        { confirmation: "reset imported data" },
        makeUser(role_enum.ADMIN),
      ),
    ).rejects.toMatchObject({
      code: "invalid_confirmation",
      status: 422,
    });
    expect(prismaMock.getPrisma).not.toHaveBeenCalled();
  });

  it("deletes imported receivables data in dependency-safe order and audits counts", async () => {
    const prisma = makePrisma({
      snapshots: 3,
      invoices: 42,
      invoice_snapshots: 76,
      collection_tasks: 9,
      promises_to_pay: 4,
      dispute_cases: 2,
      follow_ups: 12,
      exception_tags: 5,
      reconciliation_entries: 1,
      digest_events: 2,
      email_outbox: 7,
    });
    prismaMock.getPrisma.mockReturnValue(prisma);
    const { DATA_RESET_CONFIRMATION_PHRASE, resetImportedReceivablesData } =
      await import("@/server/admin/dataReset");

    const result = await resetImportedReceivablesData(
      { confirmation: DATA_RESET_CONFIRMATION_PHRASE },
      makeUser(role_enum.ADMIN),
    );

    expect(prisma.__deleteOrder).toEqual([...RESET_TABLES]);
    expect(result.deleted.invoices).toBe(42);
    expect(result.deleted.snapshots).toBe(3);
    expect(prisma.audit_log.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_user_id: "00000000-0000-0000-0000-000000000001",
        action: "admin.data_reset.imported_receivables",
        entity_type: "admin_data_reset",
        before: expect.objectContaining({
          invoices: 42,
          snapshots: 3,
        }),
        after: expect.objectContaining({
          deleted: expect.objectContaining({
            invoices: 42,
            snapshots: 3,
          }),
          preserved: expect.arrayContaining([
            "audit_log",
            "users",
            "entities",
            "credit_period_config",
            "fx_rates",
            "email_rules",
            "exception_bucket_types",
            "parties_canonical",
            "party_aliases",
          ]),
        }),
      }),
    });
  });
});

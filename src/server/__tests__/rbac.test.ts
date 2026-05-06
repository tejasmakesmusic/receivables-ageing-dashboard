/**
 * RBAC service-layer integration tests — Prisma is mocked.
 *
 * Covers spec §12 requirements:
 *  - Analyst cannot access entity outside their scope
 *  - CFO cannot edit (create/patch mutations)
 *  - PENDING users cannot access anything
 *  - Analyst with no entityIdScope is hard-blocked
 */
import { describe, it, expect, vi } from "vitest";
import {
  role_enum,
  collection_task_reason_code,
  collection_task_status,
  promise_to_pay_status,
  dispute_case_status,
} from "@/generated/prisma/enums";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError } from "@/server/core/errors";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUser(
  role: role_enum,
  entityIdScope?: string,
): AuthenticatedUser {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    email: "test@emb.global",
    name: "Test User",
    role,
    entityIdScope: entityIdScope ?? null,
    isActive: true,
    lastLoginAt: null,
  };
}

const ENTITY_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ENTITY_B = "bbbbbbbb-0000-0000-0000-000000000002";

// ── assertReadOnlyForCfo (direct import, no mock needed) ──────────────────────

describe("CFO cannot mutate", () => {
  it("assertReadOnlyForCfo throws ForbiddenError for CFO", async () => {
    const { assertReadOnlyForCfo } = await import(
      "@/server/core/assertReadOnlyForCfo"
    );
    expect(() => assertReadOnlyForCfo(makeUser(role_enum.CFO))).toThrow(
      ForbiddenError,
    );
  });

  it("blocks CFO before creating collection tasks", async () => {
    const { createCollectionTask } = await import(
      "@/server/collection-tasks/service"
    );

    await expect(
      createCollectionTask(
        {
          entity_id: ENTITY_A,
          canonical_id: "cccccccc-0000-0000-0000-000000000001",
          reason_code: collection_task_reason_code.MANUAL,
        },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("blocks CFO before patching collection tasks", async () => {
    const { patchCollectionTask } = await import(
      "@/server/collection-tasks/service"
    );

    await expect(
      patchCollectionTask(
        "dddddddd-0000-0000-0000-000000000001",
        { status: collection_task_status.IN_PROGRESS },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("blocks CFO before creating promises to pay", async () => {
    const { createPromiseToPay } = await import(
      "@/server/promises-to-pay/service"
    );

    await expect(
      createPromiseToPay(
        {
          canonical_id: "cccccccc-0000-0000-0000-000000000001",
          amount: 1000,
          currency: "INR",
          promised_date: "2026-05-15",
        },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("blocks CFO before patching promises to pay", async () => {
    const { patchPromiseToPay } = await import(
      "@/server/promises-to-pay/service"
    );

    await expect(
      patchPromiseToPay(
        "eeeeeeee-0000-0000-0000-000000000001",
        { status: promise_to_pay_status.BROKEN },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("blocks CFO before creating disputes", async () => {
    const { createDisputeCase } = await import(
      "@/server/dispute-cases/service"
    );

    await expect(
      createDisputeCase(
        {
          entity_id: ENTITY_A,
          canonical_id: "cccccccc-0000-0000-0000-000000000001",
          reason_code: "DISPUTED_BY_CLIENT",
          description: "Client disputes invoice amount",
        },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it("blocks CFO before patching disputes", async () => {
    const { patchDisputeCase } = await import(
      "@/server/dispute-cases/service"
    );

    await expect(
      patchDisputeCase(
        "ffffffff-0000-0000-0000-000000000001",
        { status: dispute_case_status.RESOLVED, resolution_note: "Resolved" },
        makeUser(role_enum.CFO),
      ),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ── assertNotPending (direct import, no mock needed) ──────────────────────────

describe("PENDING users are blocked everywhere", () => {
  it("assertNotPending throws ForbiddenError for PENDING", async () => {
    const { assertNotPending } = await import("@/server/core/assertNotPending");
    expect(() => assertNotPending(makeUser(role_enum.PENDING))).toThrow(
      ForbiddenError,
    );
  });
});

// ── assertAnalystCanAccessEntity (mocked Prisma) ───────────────────────────────

vi.mock("@/lib/prisma", () => {
  const makePrisma = () => ({
    users: {
      findUnique: vi.fn(),
    },
    entities: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(makePrisma())),
  });
  return { getPrisma: vi.fn(() => makePrisma()) };
});

describe("assertAnalystCanAccessEntity", () => {

  it("allows analyst to access their own entity", async () => {
    const { assertAnalystCanAccessEntity } = await import(
      "@/server/core/scope"
    );
    const analyst = makeUser(role_enum.ANALYST, ENTITY_A);
    // Should not throw — entity matches scope
    await expect(
      assertAnalystCanAccessEntity(analyst, ENTITY_A),
    ).resolves.not.toThrow();
  });

  it("blocks analyst from accessing a different entity", async () => {
    const { assertAnalystCanAccessEntity } = await import(
      "@/server/core/scope"
    );
    const analyst = makeUser(role_enum.ANALYST, ENTITY_A);
    // Should throw — entity B is out of scope
    await expect(
      assertAnalystCanAccessEntity(analyst, ENTITY_B),
    ).rejects.toThrow(ForbiddenError);
  });

  it("allows CFO to access any entity (no scope restriction)", async () => {
    const { assertAnalystCanAccessEntity } = await import(
      "@/server/core/scope"
    );
    const cfo = makeUser(role_enum.CFO);
    await expect(
      assertAnalystCanAccessEntity(cfo, ENTITY_B),
    ).resolves.not.toThrow();
  });

  it("allows ADMIN to access any entity", async () => {
    const { assertAnalystCanAccessEntity } = await import(
      "@/server/core/scope"
    );
    const admin = makeUser(role_enum.ADMIN);
    await expect(
      assertAnalystCanAccessEntity(admin, ENTITY_B),
    ).resolves.not.toThrow();
  });
});

// ── listCollectionTasks — ANALYST entity scope guard ─────────────────────────

describe("listCollectionTasks — analyst entity scope guard", () => {

  it("throws ForbiddenError when ANALYST has no entityIdScope", async () => {
    const { listCollectionTasks } = await import(
      "@/server/collection-tasks/service"
    );
    const analyst = makeUser(role_enum.ANALYST); // no scope
    await expect(
      listCollectionTasks({}, analyst),
    ).rejects.toThrow(ForbiddenError);
  });

  it("throws ForbiddenError when ANALYST tries to filter by entity outside scope", async () => {
    const { listCollectionTasks } = await import(
      "@/server/collection-tasks/service"
    );
    const analyst = makeUser(role_enum.ANALYST, ENTITY_A);
    await expect(
      listCollectionTasks({ entity_id: ENTITY_B }, analyst),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ── listDisputeCases — ANALYST entity scope guard ────────────────────────────

describe("listDisputeCases — analyst entity scope guard", () => {

  it("throws ForbiddenError when ANALYST has no entityIdScope", async () => {
    const { listDisputeCases } = await import(
      "@/server/dispute-cases/service"
    );
    const analyst = makeUser(role_enum.ANALYST); // no scope
    await expect(
      listDisputeCases({}, analyst),
    ).rejects.toThrow(ForbiddenError);
  });
});

// ── listPromisesToPay — ANALYST entity scope guard ───────────────────────────

describe("listPromisesToPay — analyst entity scope guard", () => {

  it("throws ForbiddenError when ANALYST has no entityIdScope", async () => {
    const { listPromisesToPay } = await import(
      "@/server/promises-to-pay/service"
    );
    const analyst = makeUser(role_enum.ANALYST); // no scope
    await expect(
      listPromisesToPay({}, analyst),
    ).rejects.toThrow(ForbiddenError);
  });
});

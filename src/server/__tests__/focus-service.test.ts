import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collection_task_reason_code,
  collection_task_status,
  dispute_case_status,
  promise_to_pay_status,
  role_enum,
} from "@/generated/prisma/enums";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError } from "@/server/core/errors";
import {
  FOCUS_QUEUE_PAGE_ROLES,
  getFocusQueue,
  isFocusQueuePageRole,
} from "@/server/focus/service";

const prismaMock = vi.hoisted(() => ({
  collection_tasks: { findMany: vi.fn() },
  follow_ups: { findMany: vi.fn() },
  promises_to_pay: { findMany: vi.fn() },
  dispute_cases: { findMany: vi.fn() },
  snapshots: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: vi.fn(() => prismaMock),
}));

const ENTITY_IND = "11111111-1111-1111-1111-111111111111";
const ENTITY_UAE = "22222222-2222-2222-2222-222222222222";
const AS_OF = new Date("2026-05-06T00:00:00.000Z");

function makeUser(
  role: role_enum,
  entityIdScope: string | null = null,
): AuthenticatedUser {
  return {
    id: "user-1",
    email: "analyst@emb.global",
    name: "Analyst",
    role,
    entityIdScope,
    isActive: true,
    lastLoginAt: null,
  };
}

function seedFocusRows() {
  prismaMock.collection_tasks.findMany.mockResolvedValue([
    {
      id: "task-ind-90",
      entity_id: ENTITY_IND,
      canonical_id: "party-ind",
      invoice_id: "invoice-ind",
      reason_code: collection_task_reason_code.NINETY_PLUS,
      priority_score: 91,
      status: collection_task_status.OPEN,
      due_date: new Date("2026-05-06T00:00:00.000Z"),
      entities: { code: "IND" },
      parties_canonical: { name: "India Customer" },
      invoices: { invoice_ref: "IND-001" },
    },
    {
      id: "task-uae-90",
      entity_id: ENTITY_UAE,
      canonical_id: "party-uae",
      invoice_id: "invoice-uae",
      reason_code: collection_task_reason_code.NINETY_PLUS,
      priority_score: 88,
      status: collection_task_status.OPEN,
      due_date: new Date("2026-05-06T00:00:00.000Z"),
      entities: { code: "UAE" },
      parties_canonical: { name: "UAE Customer" },
      invoices: { invoice_ref: "UAE-001" },
    },
  ]);

  prismaMock.follow_ups.findMany.mockResolvedValue([
    {
      id: "followup-ind-due",
      canonical_id: "party-ind",
      invoice_id: null,
      next_action_date: new Date("2026-05-06T00:00:00.000Z"),
      channel: "EMAIL",
      parties_canonical: {
        name: "India Customer",
        entity_id: ENTITY_IND,
        entities: { code: "IND" },
      },
      invoices: null,
    },
    {
      id: "followup-uae-due",
      canonical_id: "party-uae",
      invoice_id: null,
      next_action_date: new Date("2026-05-06T00:00:00.000Z"),
      channel: "CALL",
      parties_canonical: {
        name: "UAE Customer",
        entity_id: ENTITY_UAE,
        entities: { code: "UAE" },
      },
      invoices: null,
    },
  ]);

  prismaMock.promises_to_pay.findMany.mockResolvedValue([
    {
      id: "ptp-ind-broken",
      canonical_id: "party-ind",
      invoice_id: "invoice-ind",
      amount: 12500,
      currency: "INR",
      promised_date: new Date("2026-05-01T00:00:00.000Z"),
      status: promise_to_pay_status.BROKEN,
      parties_canonical: {
        name: "India Customer",
        entity_id: ENTITY_IND,
        entities: { code: "IND" },
      },
      invoices: { invoice_ref: "IND-001" },
    },
  ]);

  prismaMock.dispute_cases.findMany.mockResolvedValue([
    {
      id: "dispute-ind-open",
      entity_id: ENTITY_IND,
      canonical_id: "party-ind",
      invoice_id: "invoice-ind",
      reason_code: "AMOUNT_DISPUTED",
      description: "Amount mismatch",
      status: dispute_case_status.IN_REVIEW,
      expected_resolution_date: new Date("2026-05-08T00:00:00.000Z"),
      entities: { code: "IND" },
      parties_canonical: { name: "India Customer" },
      invoices: { invoice_ref: "IND-001" },
    },
  ]);

  prismaMock.snapshots.findMany.mockImplementation(({ where }) => {
    if (where.status === "STAGED") {
      return Promise.resolve([
        {
          id: "snapshot-ind-staged",
          entity_id: ENTITY_IND,
          as_of_date: new Date("2026-05-05T00:00:00.000Z"),
          source_hint: "TALLY",
          status: "STAGED",
          parse_result_json: {
            invoices: [
              { row_index: 7, status: "PARSE_ERROR" },
              {
                row_index: 8,
                status: "OK",
                alias_resolution: { resolutionState: "UNMAPPED" },
              },
            ],
            credit_periods: [],
            errors: [],
            warnings: [{ code: "UNALLOCATED_CREDITS_DELTA" }],
          },
          staging_overrides_json: [],
          warnings_acknowledged_json: [],
          entities: { code: "IND" },
        },
      ]);
    }

    return Promise.resolve([
      {
        id: "snapshot-uae-mismatch",
        entity_id: ENTITY_UAE,
        as_of_date: new Date("2026-05-04T00:00:00.000Z"),
        source_hint: "XERO",
        status: "PUBLISHED",
        reconciliation_entries: { status: "MISMATCHED", delta: 42 },
        entities: { code: "UAE" },
      },
    ]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedFocusRows();
});

describe("focus queue page roles", () => {
  it("excludes PENDING so page auth redirects before loading focus data", () => {
    expect(FOCUS_QUEUE_PAGE_ROLES).toEqual([
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    ]);
    expect(isFocusQueuePageRole(role_enum.PENDING)).toBe(false);
  });
});

describe("getFocusQueue", () => {
  it("scopes analyst queue items to the analyst entity", async () => {
    const response = await getFocusQueue(
      { asOfDate: AS_OF },
      makeUser(role_enum.ANALYST, ENTITY_IND),
    );

    expect(response.items).not.toHaveLength(0);
    expect(response.items.every((item) => item.entity_code === "IND")).toBe(
      true,
    );
    expect(response.visible_entity_codes).toEqual(["IND"]);
    expect(response.is_read_only).toBe(false);
  });

  it("returns a read-only cross-entity summary for CFO users", async () => {
    const response = await getFocusQueue(
      { asOfDate: AS_OF },
      makeUser(role_enum.CFO),
    );

    expect(response.is_read_only).toBe(true);
    expect(response.visible_entity_codes).toEqual(["IND", "UAE"]);
    expect(response.items.some((item) => item.entity_code === "IND")).toBe(
      true,
    );
    expect(response.items.some((item) => item.entity_code === "UAE")).toBe(
      true,
    );
  });

  it("hard-blocks analysts without an entity scope", async () => {
    await expect(
      getFocusQueue({ asOfDate: AS_OF }, makeUser(role_enum.ANALYST)),
    ).rejects.toThrow(ForbiddenError);
  });

  it("includes all launch queue sources with ranked explanations", async () => {
    const response = await getFocusQueue(
      { asOfDate: AS_OF },
      makeUser(role_enum.CFO),
    );

    expect(response.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "task-ind-90",
        "followup-ind-due",
        "ptp-ind-broken",
        "dispute-ind-open",
        "snapshot-ind-staged",
        "snapshot-uae-mismatch",
      ]),
    );
    expect(response.items.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "TASK",
        "PTP",
        "DISPUTE",
        "STAGING_BLOCKER",
        "RECONCILIATION",
      ]),
    );
    expect(response.items.every((item) => item.reason.length > 0)).toBe(true);
    expect(response.items.every((item) => item.href.startsWith("/"))).toBe(
      true,
    );
  });
});

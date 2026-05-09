import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { assertReadOnlyForCfo } from "@/server/core/assertReadOnlyForCfo";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { role_enum, dispute_case_status } from "@/generated/prisma/enums";

export interface DisputeCaseListQuery {
  entity_id?: string;
  canonical_id?: string;
  status?: dispute_case_status;
  page?: number;
  page_size?: number;
}

export interface CreateDisputeCaseInput {
  entity_id: string;
  canonical_id: string;
  invoice_id?: string;
  reason_code: string;
  description: string;
  owner_user_id?: string;
  expected_resolution_date?: string; // YYYY-MM-DD
}

export interface PatchDisputeCaseInput {
  status?: dispute_case_status;
  owner_user_id?: string | null;
  expected_resolution_date?: string | null;
  resolution_note?: string;
}

// Valid status transitions
const ALLOWED_DISPUTE_TRANSITIONS: Record<dispute_case_status, dispute_case_status[]> = {
  [dispute_case_status.OPEN]: [
    dispute_case_status.IN_REVIEW,
    dispute_case_status.WAITING_ON_CUSTOMER,
    dispute_case_status.RESOLVED,
    dispute_case_status.CLOSED,
  ],
  [dispute_case_status.IN_REVIEW]: [
    dispute_case_status.OPEN,
    dispute_case_status.WAITING_ON_CUSTOMER,
    dispute_case_status.RESOLVED,
    dispute_case_status.CLOSED,
  ],
  [dispute_case_status.WAITING_ON_CUSTOMER]: [
    dispute_case_status.IN_REVIEW,
    dispute_case_status.RESOLVED,
    dispute_case_status.CLOSED,
  ],
  [dispute_case_status.RESOLVED]: [
    dispute_case_status.CLOSED,
  ],
  [dispute_case_status.CLOSED]: [],
};

export async function listDisputeCases(
  query: DisputeCaseListQuery,
  user: AuthenticatedUser,
) {
  const { entity_id, canonical_id, status, page = 1, page_size = 50 } = query;

  // Analysts must have an entity scope — reject immediately if missing
  if (user.role === role_enum.ANALYST) {
    if (!user.entityIdScope) {
      throw new ForbiddenError("Analyst user has no entity scope");
    }
    if (entity_id) {
      await assertAnalystCanAccessEntity(user, entity_id);
    }
  }

  const where = {
    ...(entity_id ? { entity_id } : {}),
    ...(canonical_id ? { canonical_id } : {}),
    ...(status ? { status } : {}),
    // Analysts with no explicit entity filter are scoped to their assigned entity
    ...(user.role === role_enum.ANALYST && !entity_id
      ? { entity_id: user.entityIdScope! }
      : {}),
  };

  const [items, total] = await getPrisma().$transaction([
    getPrisma().dispute_cases.findMany({
      where,
      include: {
        parties_canonical: { select: { name: true } },
        entities: { select: { code: true } },
        invoices: { select: { invoice_ref: true } },
        users_dispute_cases_owner_user_idTousers: { select: { name: true, email: true } },
      },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    getPrisma().dispute_cases.count({ where }),
  ]);

  return { items, total, page, page_size };
}

export async function getDisputeCase(id: string, user: AuthenticatedUser) {
  const dispute = await getPrisma().dispute_cases.findUnique({ where: { id } });

  if (!dispute) {
    throw new HttpError("not_found", 404, "Dispute case not found");
  }

  await assertAnalystCanAccessEntity(user, dispute.entity_id);

  return dispute;
}

export async function createDisputeCase(
  input: CreateDisputeCaseInput,
  user: AuthenticatedUser,
) {
  assertReadOnlyForCfo(user);
  await assertAnalystCanAccessEntity(user, input.entity_id);

  const id = createId();
  const now = new Date();

  const dispute = await getPrisma().$transaction(async (tx) => {
    // Validate canonical_id belongs to entity_id — prevents cross-entity contamination
    const party = await tx.parties_canonical.findFirst({
      where: { id: input.canonical_id, entity_id: input.entity_id },
      select: { id: true },
    });
    if (!party) {
      throw new HttpError(
        "not_found",
        404,
        "Canonical party not found in entity",
      );
    }

    const created = await tx.dispute_cases.create({
      data: {
        id,
        entity_id: input.entity_id,
        canonical_id: input.canonical_id,
        invoice_id: input.invoice_id ?? null,
        reason_code: input.reason_code,
        description: input.description,
        status: dispute_case_status.OPEN,
        owner_user_id: input.owner_user_id ?? null,
        expected_resolution_date: input.expected_resolution_date
          ? new Date(input.expected_resolution_date)
          : null,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action: "dispute_case.create",
        entity_type: "dispute_cases",
        entity_id: id,
        before: Prisma.JsonNull,
        after: {
          entity_id: input.entity_id,
          canonical_id: input.canonical_id,
          invoice_id: input.invoice_id ?? null,
          reason_code: input.reason_code,
        },
      },
    });

    return created;
  });

  return dispute;
}

export async function patchDisputeCase(
  id: string,
  input: PatchDisputeCaseInput,
  user: AuthenticatedUser,
) {
  assertReadOnlyForCfo(user);

  const dispute = await getPrisma().dispute_cases.findUnique({ where: { id } });
  if (!dispute) {
    throw new HttpError("not_found", 404, "Dispute case not found");
  }

  await assertAnalystCanAccessEntity(user, dispute.entity_id);

  // Validate status transition if requested
  if (input.status && input.status !== dispute.status) {
    const allowed = ALLOWED_DISPUTE_TRANSITIONS[dispute.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new HttpError(
        "invalid_transition",
        422,
        `Cannot transition dispute from ${dispute.status} to ${input.status}`,
      );
    }
    // resolution_note required when resolving
    if (
      input.status === dispute_case_status.RESOLVED &&
      !input.resolution_note
    ) {
      throw new HttpError(
        "resolution_note_required",
        422,
        "resolution_note is required when resolving a dispute",
      );
    }
  }

  const now = new Date();

  const updated = await getPrisma().$transaction(async (tx) => {
    const result = await tx.dispute_cases.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.owner_user_id !== undefined
          ? { owner_user_id: input.owner_user_id }
          : {}),
        ...(input.expected_resolution_date !== undefined
          ? {
              expected_resolution_date: input.expected_resolution_date
                ? new Date(input.expected_resolution_date)
                : null,
            }
          : {}),
        ...(input.resolution_note
          ? { resolution_note: input.resolution_note }
          : {}),
        // Only set resolved_at when actively resolving — never overwrite on other PATCHes
        ...(input.status === dispute_case_status.RESOLVED
          ? { resolved_at: now }
          : {}),
        updated_at: now,
      },
    });

    const action = input.status
      ? input.status === dispute_case_status.RESOLVED
        ? "dispute_case.resolve"
        : input.status === dispute_case_status.CLOSED
          ? "dispute_case.close"
          : "dispute_case.status_change"
      : input.owner_user_id !== undefined
        ? "dispute_case.assign"
        : "dispute_case.update";

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action,
        entity_type: "dispute_cases",
        entity_id: id,
        before: { status: dispute.status, owner_user_id: dispute.owner_user_id },
        after: {
          status: result.status,
          owner_user_id: result.owner_user_id,
          resolution_note: result.resolution_note,
        },
      },
    });

    return result;
  });

  return updated;
}

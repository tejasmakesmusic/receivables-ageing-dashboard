import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { assertReadOnlyForCfo } from "@/server/core/assertReadOnlyForCfo";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { role_enum, promise_to_pay_status } from "@/generated/prisma/enums";

export interface PromiseToPayListQuery {
  canonical_id?: string;
  invoice_id?: string;
  status?: promise_to_pay_status;
  page?: number;
  page_size?: number;
}

export interface CreatePromiseToPayInput {
  canonical_id: string;
  invoice_id?: string;
  collection_task_id?: string;
  amount: number;
  currency: string;
  promised_date: string; // YYYY-MM-DD
  contact_person?: string;
  notes?: string;
}

export interface PatchPromiseToPayInput {
  status?: promise_to_pay_status;
  notes?: string;
  contact_person?: string;
}

// Valid status transitions
const ALLOWED_PTP_TRANSITIONS: Record<promise_to_pay_status, promise_to_pay_status[]> = {
  [promise_to_pay_status.OPEN]: [
    promise_to_pay_status.KEPT,
    promise_to_pay_status.BROKEN,
    promise_to_pay_status.CANCELLED,
  ],
  [promise_to_pay_status.KEPT]: [],
  [promise_to_pay_status.BROKEN]: [],
  [promise_to_pay_status.CANCELLED]: [],
};

export async function listPromisesToPay(
  query: PromiseToPayListQuery,
  user: AuthenticatedUser,
) {
  const { canonical_id, invoice_id, status, page = 1, page_size = 50 } = query;

  // Analysts must have an entity scope — reject immediately if missing
  if (user.role === role_enum.ANALYST && !user.entityIdScope) {
    throw new ForbiddenError("Analyst user has no entity scope");
  }

  // Entity scope is enforced at the DB level via the parties_canonical join
  const entityScopeWhere =
    user.role === role_enum.ANALYST
      ? { parties_canonical: { entity_id: user.entityIdScope! } }
      : {};

  const where = {
    ...entityScopeWhere,
    ...(canonical_id ? { canonical_id } : {}),
    ...(invoice_id ? { invoice_id } : {}),
    ...(status ? { status } : {}),
  };

  const [items, total] = await getPrisma().$transaction([
    getPrisma().promises_to_pay.findMany({
      where,
      include: { parties_canonical: { select: { name: true, entity_id: true } } },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    getPrisma().promises_to_pay.count({ where }),
  ]);

  return { items, total, page, page_size };
}

export async function getPromiseToPay(id: string, user: AuthenticatedUser) {
  const ptp = await getPrisma().promises_to_pay.findUnique({
    where: { id },
    include: { parties_canonical: { select: { entity_id: true } } },
  });

  if (!ptp) {
    throw new HttpError("not_found", 404, "Promise to pay not found");
  }

  // Defensive guard — parties_canonical should always be present (Restrict FK),
  // but protect against orphaned rows from out-of-band DB operations
  if (!ptp.parties_canonical) {
    throw new HttpError("not_found", 404, "Party data unavailable for this promise");
  }

  await assertAnalystCanAccessEntity(user, ptp.parties_canonical.entity_id);

  // Return only base PTP fields — don't leak the canonical party join
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { parties_canonical: _canon, ...ptpData } = ptp;
  return ptpData;
}

export async function createPromiseToPay(
  input: CreatePromiseToPayInput,
  user: AuthenticatedUser,
) {
  assertReadOnlyForCfo(user);

  // Look up entity_id via canonical party for scope assertion
  const party = await getPrisma().parties_canonical.findUnique({
    where: { id: input.canonical_id },
    select: { entity_id: true },
  });
  if (!party) {
    throw new HttpError("not_found", 404, "Canonical party not found");
  }
  await assertAnalystCanAccessEntity(user, party.entity_id);

  const id = createId();
  const now = new Date();

  const ptp = await getPrisma().$transaction(async (tx) => {
    const created = await tx.promises_to_pay.create({
      data: {
        id,
        canonical_id: input.canonical_id,
        invoice_id: input.invoice_id ?? null,
        collection_task_id: input.collection_task_id ?? null,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        promised_date: new Date(input.promised_date),
        status: promise_to_pay_status.OPEN,
        contact_person: input.contact_person ?? null,
        notes: input.notes ?? null,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action: "promise_to_pay.create",
        entity_type: "promises_to_pay",
        entity_id: id,
        before: Prisma.JsonNull,
        after: {
          canonical_id: input.canonical_id,
          invoice_id: input.invoice_id ?? null,
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          promised_date: input.promised_date,
        },
      },
    });

    return created;
  });

  return ptp;
}

export async function patchPromiseToPay(
  id: string,
  input: PatchPromiseToPayInput,
  user: AuthenticatedUser,
) {
  assertReadOnlyForCfo(user);

  const ptp = await getPrisma().promises_to_pay.findUnique({
    where: { id },
    include: { parties_canonical: { select: { entity_id: true } } },
  });
  if (!ptp) {
    throw new HttpError("not_found", 404, "Promise to pay not found");
  }
  if (!ptp.parties_canonical) {
    throw new HttpError("not_found", 404, "Party data unavailable for this promise");
  }

  await assertAnalystCanAccessEntity(user, ptp.parties_canonical.entity_id);

  // Validate status transition if requested
  if (input.status && input.status !== ptp.status) {
    const allowed = ALLOWED_PTP_TRANSITIONS[ptp.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new HttpError(
        "invalid_transition",
        422,
        `Cannot transition promise from ${ptp.status} to ${input.status}`,
      );
    }
  }

  const now = new Date();

  const updated = await getPrisma().$transaction(async (tx) => {
    const result = await tx.promises_to_pay.update({
      where: { id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.contact_person !== undefined
          ? { contact_person: input.contact_person }
          : {}),
        updated_at: now,
      },
    });

    const action =
      input.status === promise_to_pay_status.KEPT
        ? "promise_to_pay.kept"
        : input.status === promise_to_pay_status.BROKEN
          ? "promise_to_pay.broken"
          : input.status === promise_to_pay_status.CANCELLED
            ? "promise_to_pay.cancelled"
            : "promise_to_pay.update";

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action,
        entity_type: "promises_to_pay",
        entity_id: id,
        before: { status: ptp.status },
        after: { status: result.status, notes: result.notes },
      },
    });

    return result;
  });

  return updated;
}

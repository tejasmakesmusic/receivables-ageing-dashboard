import "server-only";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { HttpError } from "@/server/core/errors";
import type { AuthenticatedUser } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export interface PatchEmailRuleInput {
  is_active?: boolean;
  recipients_json?: string[]; // list of email addresses
  cron_schedule?: string;
  notes?: string;
}

function assertAdmin(user: AuthenticatedUser) {
  if (user.role !== role_enum.ADMIN) {
    throw new HttpError("forbidden", 403, "Admin role required");
  }
}

export async function listEmailRules(user: AuthenticatedUser) {
  assertAdmin(user);
  return getPrisma().email_rules.findMany({ orderBy: { rule_type: "asc" } });
}

export async function getEmailRule(id: string, user: AuthenticatedUser) {
  assertAdmin(user);
  const rule = await getPrisma().email_rules.findUnique({ where: { id } });
  if (!rule) {
    throw new HttpError("not_found", 404, "Email rule not found");
  }
  return rule;
}

export async function patchEmailRule(
  id: string,
  input: PatchEmailRuleInput,
  user: AuthenticatedUser,
) {
  assertAdmin(user);

  const rule = await getPrisma().email_rules.findUnique({ where: { id } });
  if (!rule) {
    throw new HttpError("not_found", 404, "Email rule not found");
  }

  const now = new Date();
  const updated = await getPrisma().$transaction(async (tx) => {
    const result = await tx.email_rules.update({
      where: { id },
      data: {
        ...(input.is_active !== undefined ? { is_active: input.is_active } : {}),
        ...(input.recipients_json !== undefined
          ? { recipients_json: input.recipients_json }
          : {}),
        ...(input.cron_schedule !== undefined
          ? { cron_schedule: input.cron_schedule }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        updated_by: user.id,
        updated_at: now,
      },
    });

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action: "email_rule.update",
        entity_type: "email_rules",
        entity_id: id,
        before: {
          is_active: rule.is_active,
          recipients_json: rule.recipients_json,
        },
        after: {
          is_active: result.is_active,
          recipients_json: result.recipients_json,
        },
      },
    });

    return result;
  });

  return updated;
}

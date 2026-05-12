import { z } from "zod";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import type {
  ColumnMappingField,
  ColumnMappingResult,
  SourceHint,
} from "@/server/parsers/common";
import { role_enum } from "@/generated/prisma/enums";

/**
 * PR 8a — saved-default mappings per (entity, source). The parsers don't
 * yet read these (PR 8b will rebuild them as override-driven), but they
 * are written so:
 *   • Drift detection on next upload uses the saved version as the source
 *     of truth.
 *   • The audit log captures analyst intent.
 */
export const saveColumnMappingSchema = z.object({
  source_hint: z.enum(["TALLY", "XERO", "CREDIT_PERIOD"]),
  // The mapping payload is the same shape as ColumnMappingResult.fields,
  // wrapped under the same structure as detection emits so we can compare
  // apples-to-apples.
  mapping: z.object({
    source_hint: z.enum(["TALLY", "XERO", "CREDIT_PERIOD"]),
    layout_variant: z.string().min(1).max(64),
    fields: z.record(
      z.string(),
      z.object({
        source: z.string().nullable(),
        confidence: z.enum(["EXACT", "HEURISTIC", "MISSING"]),
      }),
    ),
  }),
});
export type SaveColumnMappingInput = z.infer<typeof saveColumnMappingSchema>;

/**
 * Diff two column-mapping descriptors. Returns one human-readable line per
 * field that drifted (added, removed, or pointed at a different source).
 *
 * Used by the upload path (saved vs. detected) and by the staging UI
 * (saved vs. snapshot's captured mapping).
 */
export function compareColumnMappings(
  baseline: ColumnMappingResult,
  next: ColumnMappingResult,
): string[] {
  const out: string[] = [];
  if (baseline.layout_variant !== next.layout_variant) {
    out.push(
      `layout: ${baseline.layout_variant} → ${next.layout_variant}`,
    );
  }
  const allKeys = new Set([
    ...Object.keys(baseline.fields ?? {}),
    ...Object.keys(next.fields ?? {}),
  ]);
  for (const key of allKeys) {
    const a = baseline.fields?.[key];
    const b = next.fields?.[key];
    if (!a && b) {
      out.push(`${key}: NEW (${describeField(b)})`);
      continue;
    }
    if (a && !b) {
      out.push(`${key}: REMOVED (was ${describeField(a)})`);
      continue;
    }
    if (!a || !b) continue;
    if (a.source !== b.source) {
      out.push(`${key}: ${describeField(a)} → ${describeField(b)}`);
    }
  }
  return out;
}

function describeField(f: ColumnMappingField): string {
  if (f.source == null) return "<missing>";
  return f.source;
}

export interface ColumnMappingRow {
  entity_id: string;
  source_hint: SourceHint;
  mapping: ColumnMappingResult;
  created_by_email: string | null;
  created_at: string;
  updated_by_email: string | null;
  updated_at: string;
}

export async function getSavedColumnMapping(
  entityId: string,
  sourceHint: SourceHint,
): Promise<ColumnMappingRow | null> {
  const prisma = getPrisma();
  const row = await prisma.column_mappings.findUnique({
    where: {
      entity_id_source_hint: {
        entity_id: entityId,
        source_hint: sourceHint,
      },
    },
    include: {
      users_column_mappings_created_byTousers: { select: { email: true } },
      users_column_mappings_updated_byTousers: { select: { email: true } },
    },
  });
  if (!row) return null;
  return {
    entity_id: row.entity_id,
    source_hint: row.source_hint as SourceHint,
    mapping: row.mapping_json as unknown as ColumnMappingResult,
    created_by_email:
      row.users_column_mappings_created_byTousers?.email ?? null,
    created_at: row.created_at.toISOString(),
    updated_by_email:
      row.users_column_mappings_updated_byTousers?.email ?? null,
    updated_at: row.updated_at.toISOString(),
  };
}

export async function saveColumnMapping(
  entityId: string,
  body: SaveColumnMappingInput,
  currentUser: AuthenticatedUser,
): Promise<ColumnMappingRow> {
  if (
    currentUser.role === role_enum.CFO ||
    currentUser.role === role_enum.REVIEWER ||
    currentUser.role === role_enum.PENDING
  ) {
    throw new ForbiddenError(
      `${currentUser.role} users cannot edit saved column mappings`,
    );
  }
  if (
    currentUser.role === role_enum.ANALYST &&
    currentUser.entityIdScope &&
    currentUser.entityIdScope !== entityId
  ) {
    throw new ForbiddenError("Analyst is not scoped to this entity");
  }
  if (body.mapping.source_hint !== body.source_hint) {
    throw new HttpError(
      "validation_error",
      400,
      "mapping.source_hint must match the wrapper source_hint",
    );
  }

  const prisma = getPrisma();
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.column_mappings.findUnique({
      where: {
        entity_id_source_hint: {
          entity_id: entityId,
          source_hint: body.source_hint,
        },
      },
      select: { id: true, mapping_json: true },
    });

    let saved;
    if (existing) {
      saved = await tx.column_mappings.update({
        where: { id: existing.id },
        data: {
          mapping_json: body.mapping as unknown as object,
          updated_by: currentUser.id,
          updated_at: now,
        },
        include: {
          users_column_mappings_created_byTousers: { select: { email: true } },
          users_column_mappings_updated_byTousers: { select: { email: true } },
        },
      });
    } else {
      saved = await tx.column_mappings.create({
        data: {
          id: createId(),
          entity_id: entityId,
          source_hint: body.source_hint,
          mapping_json: body.mapping as unknown as object,
          created_by: currentUser.id,
          created_at: now,
          updated_by: currentUser.id,
          updated_at: now,
        },
        include: {
          users_column_mappings_created_byTousers: { select: { email: true } },
          users_column_mappings_updated_byTousers: { select: { email: true } },
        },
      });
    }

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: currentUser.id,
        action: existing ? "column_mapping.update" : "column_mapping.create",
        entity_type: "column_mappings",
        entity_id: saved.id,
        before: existing
          ? (existing.mapping_json as unknown as object)
          : undefined,
        after: body.mapping as unknown as object,
      },
    });

    return saved;
  });

  return {
    entity_id: result.entity_id,
    source_hint: result.source_hint as SourceHint,
    mapping: result.mapping_json as unknown as ColumnMappingResult,
    created_by_email:
      result.users_column_mappings_created_byTousers?.email ?? null,
    created_at: result.created_at.toISOString(),
    updated_by_email:
      result.users_column_mappings_updated_byTousers?.email ?? null,
    updated_at: result.updated_at.toISOString(),
  };
}

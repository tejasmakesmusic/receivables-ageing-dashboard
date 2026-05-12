import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import {
  getSavedColumnMapping,
  saveColumnMapping,
  saveColumnMappingSchema,
} from "@/server/column-mappings/service";
import type { SourceHint } from "@/server/parsers/common";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  entity: z.enum(["IND", "UAE"]),
  source_hint: z.enum(["TALLY", "XERO", "CREDIT_PERIOD"]),
});

const putBodySchema = saveColumnMappingSchema.extend({
  entity: z.enum(["IND", "UAE"]),
});

/**
 * PR 8a — saved-default column mappings per (entity, source).
 *
 *   GET ?entity=IND&source_hint=TALLY  → 200 ColumnMappingRow | 404
 *   PUT { entity, source_hint, mapping } → 200 ColumnMappingRow
 */
export async function GET(request: NextRequest) {
  try {
    await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const params = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const entity = await getPrisma().entities.findUnique({
      where: { code: params.entity },
      select: { id: true },
    });
    if (!entity) {
      return NextResponse.json(
        { code: "not_found", message: "Entity not found", status: 404 },
        { status: 404 },
      );
    }
    const row = await getSavedColumnMapping(
      entity.id,
      params.source_hint as SourceHint,
    );
    if (!row) {
      return NextResponse.json(
        {
          code: "not_found",
          message: "No saved mapping for this entity + source",
          status: 404,
        },
        { status: 404 },
      );
    }
    return NextResponse.json(row);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const body = putBodySchema.parse(await request.json());
    const entity = await getPrisma().entities.findUnique({
      where: { code: body.entity },
      select: { id: true },
    });
    if (!entity) {
      return NextResponse.json(
        { code: "not_found", message: "Entity not found", status: 404 },
        { status: 404 },
      );
    }
    const row = await saveColumnMapping(
      entity.id,
      { source_hint: body.source_hint, mapping: body.mapping },
      currentUser,
    );
    return NextResponse.json(row);
  } catch (error) {
    return toErrorResponse(error);
  }
}

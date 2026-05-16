import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  listSnapshots,
  snapshotListFiltersSchema,
} from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

function parseStatusParams(params: URLSearchParams): string[] | undefined {
  const repeated = params.getAll("status").filter(Boolean);
  if (repeated.length > 1) {
    return repeated;
  }

  const single = repeated[0];
  return single
    ? single
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const params = request.nextUrl.searchParams;
    const filters = snapshotListFiltersSchema.parse({
      entity_code: params.get("entity_code") ?? undefined,
      status: parseStatusParams(params),
      page: params.get("page") ?? undefined,
      page_size: params.get("page_size") ?? undefined,
    });
    const response = await listSnapshots(filters, currentUser);

    return NextResponse.json(response);
  } catch (error) {
    return toErrorResponse(error);
  }
}

// POST removed — uploads are handled exclusively by /api/snapshots/upload
// (see ADR-equivalent note in audit 2026-05-16). Keeping a single canonical
// upload endpoint avoids divergent error-envelope drift.

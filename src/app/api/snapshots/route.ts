import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  createSnapshotFromUpload,
  listSnapshots,
  snapshotUploadSchema,
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

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: "validation_error", message: "file is required", status: 400 },
        { status: 400 },
      );
    }

    const body = snapshotUploadSchema.parse({
      entity_code: formData.get("entity_code"),
      as_of_date: formData.get("as_of_date") || undefined,
      source_hint: formData.get("source_hint") || undefined,
    });
    const response = await createSnapshotFromUpload({
      fileBytes: new Uint8Array(await file.arrayBuffer()),
      fileName: file.name,
      body,
      currentUser,
    });

    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

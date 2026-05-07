import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { validateUpload } from "@/lib/upload-validation";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  createSnapshotFromUpload,
  snapshotUploadSchema,
} from "@/server/snapshots/service";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ANALYST, role_enum.ADMIN);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: { code: "VALIDATION_ERROR", message: "file is required" },
        },
        { status: 400 },
      );
    }

    const validation = validateUpload({
      filename: file.name,
      size: file.size,
      mime: file.type,
    });
    if (!validation.ok) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: validation.code,
            message: validation.message,
          },
        },
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

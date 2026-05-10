import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import {
  createLob,
  createLobSchema,
  listLobs,
} from "@/server/lobs/service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  entity_code: z.enum(["IND", "UAE"]).optional(),
  active: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const filters = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    return NextResponse.json({ items: await listLobs(filters, currentUser) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const body = createLobSchema.parse(await request.json());
    const row = await createLob(body, currentUser);
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

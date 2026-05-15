import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { searchParties } from "@/server/parties/search";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  name_contains: z
    .string()
    .min(2, "name_contains must be at least 2 characters"),
  entity_code: z.enum(["IND", "UAE"]).optional(),
  page_size: z.coerce.number().int().min(1).max(20).default(10),
});

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );

    const params = Object.fromEntries(
      request.nextUrl.searchParams.entries(),
    );
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      throw new HttpError(
        "validation_error",
        400,
        parsed.error.issues[0]?.message ?? "Invalid query parameters",
      );
    }

    const items = await searchParties(
      parsed.data.name_contains,
      parsed.data.entity_code,
      parsed.data.page_size,
      currentUser,
    );

    return NextResponse.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}

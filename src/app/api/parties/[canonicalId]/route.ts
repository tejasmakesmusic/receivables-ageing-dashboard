import { z } from "zod";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertAnalystCanAccessEntity } from "@/server/core/scope";
import { getPartyDetail, getPartyEntityId } from "@/server/parties/service";

export const dynamic = "force-dynamic";

const canonicalIdSchema = z.string().uuid("Invalid canonical ID");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ canonicalId: string }> },
) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const { canonicalId } = await params;
    const parsedId = canonicalIdSchema.safeParse(canonicalId);
    if (!parsedId.success) {
      return NextResponse.json(
        { detail: parsedId.error.issues[0]?.message ?? "Invalid canonical ID" },
        { status: 400 },
      );
    }

    const entityId = await getPartyEntityId(parsedId.data);
    if (!entityId) {
      return NextResponse.json({ detail: "Party not found" }, { status: 404 });
    }

    await assertAnalystCanAccessEntity(currentUser, entityId);

    const party = await getPartyDetail(parsedId.data);
    if (!party) {
      return NextResponse.json({ detail: "Party not found" }, { status: 404 });
    }

    return NextResponse.json(party);
  } catch (error) {
    return toErrorResponse(error);
  }
}

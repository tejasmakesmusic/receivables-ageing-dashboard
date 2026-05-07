import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { toErrorResponse } from "@/server/core/errors";
import { tickStreaks } from "@/server/engagement/streaks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);
  return (
    new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) ===
    value
  );
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    const isCronRequest =
      Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
    const date = new URL(request.url).searchParams.get("date");

    if (isCronRequest && date) {
      return NextResponse.json(
        {
          code: "unauthorized",
          message: "Admin role required for date override",
        },
        { status: 401 },
      );
    }

    let actorUserId: string;

    if (isCronRequest) {
      actorUserId = process.env.CRON_ACTOR_USER_ID ?? "system";
    } else {
      try {
        const user = await requireRole(role_enum.ADMIN);
        assertNotPending(user);
        actorUserId = user.id;
      } catch {
        return NextResponse.json(
          {
            code: "unauthorized",
            message: "Admin role or CRON_SECRET required",
          },
          { status: 401 },
        );
      }
    }

    if (date && !isValidDateOnly(date)) {
      return NextResponse.json(
        {
          code: "validation_error",
          message: "date must be a valid YYYY-MM-DD date",
        },
        { status: 400 },
      );
    }

    const counts = await tickStreaks({
      actorUserId,
      ...(date ? { asOfDate: date } : {}),
    });

    return NextResponse.json(counts);
  } catch (error) {
    return toErrorResponse(error);
  }
}

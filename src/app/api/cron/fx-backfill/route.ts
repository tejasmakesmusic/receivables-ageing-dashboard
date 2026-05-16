/**
 * ADR-0014 / ADR-0015 — daily FX rate maintenance.
 *
 * Vercel cron tick: appends rates from frankfurter.app (with AED via
 * USD peg) for every (from, to) pair already in fx_rates with
 * source='API', closing the previously-OPEN row before each insert.
 *
 * Auth: Bearer CRON_SECRET (matches the streak-tick / email-outbox
 * convention) for cron invocations; ADMIN role for manual triggers.
 *
 * Method: GET so Vercel's default cron behavior works without extra
 * configuration; POST is also accepted for manual curl invocations.
 */
import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { toErrorResponse } from "@/server/core/errors";
import { appendDailyRates } from "@/server/fx/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function resolveActor(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCronRequest =
    Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`;
  if (isCronRequest) {
    return process.env.CRON_ACTOR_USER_ID ?? "system";
  }
  const user = await requireRole(role_enum.ADMIN);
  assertNotPending(user);
  return user.id;
}

async function handle(request: NextRequest): Promise<NextResponse> {
  try {
    let actorUserId: string;
    try {
      actorUserId = await resolveActor(request);
    } catch {
      return NextResponse.json(
        {
          code: "unauthorized",
          message: "Admin role or CRON_SECRET required",
        },
        { status: 401 },
      );
    }

    const result = await appendDailyRates({ actorUserId });
    return NextResponse.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export const GET = handle;
export const POST = handle;

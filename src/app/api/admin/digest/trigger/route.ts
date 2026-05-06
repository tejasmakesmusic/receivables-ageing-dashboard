import { NextRequest, NextResponse } from "next/server";
import { role_enum, digest_event_state } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { assertNotPending } from "@/server/core/assertNotPending";
import { triggerDigestForDate, buildDigestPayload } from "@/server/digest/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/digest/trigger
 *
 * Creates (or retrieves) a digest event for the given date and builds the
 * payload. Called by Vercel Cron at UTC 03:30 Mon-Fri (IST 09:00) and
 * manually by admins.
 *
 * Cron requests arrive with Authorization: Bearer {CRON_SECRET}.
 * Admin browser requests use the normal session cookie.
 */
export async function POST(request: NextRequest) {
  try {
    // Accept both Vercel Cron key and authenticated admin session
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    const isCronRequest =
      cronSecret && authHeader === `Bearer ${cronSecret}`;

    let actorId: string;

    if (isCronRequest) {
      // Cron path: use a fixed system actor ID sourced from env or a fallback
      actorId = process.env.CRON_ACTOR_USER_ID ?? "system";
    } else {
      // Admin browser path: require ADMIN role
      const user = await requireRole(role_enum.ADMIN);
      assertNotPending(user);
      actorId = user.id;
    }

    // Determine date: default to today in UTC, allow override for testing
    const body = await request.json().catch(() => ({})) as { date?: string };
    const digestDate =
      body.date ?? new Date().toISOString().slice(0, 10);

    // Validate format and calendar validity (L3: reject e.g. "2026-13-45")
    if (!/^\d{4}-\d{2}-\d{2}$/.test(digestDate) || isNaN(Date.parse(digestDate))) {
      return NextResponse.json(
        { error: "validation_error", detail: "date must be a valid YYYY-MM-DD" },
        { status: 400 },
      );
    }

    const event = await triggerDigestForDate(digestDate, actorId);

    // M1: If already APPROVED/SENT/SKIPPED/FAILED, skip rebuild to avoid 422
    // (Vercel cron is at-least-once — a double-fire on the same day must be a no-op)
    const rebuildableStates: digest_event_state[] = [
      digest_event_state.DRAFT,
      digest_event_state.PREVIEWED,
    ];
    if (!rebuildableStates.includes(event.state)) {
      return NextResponse.json(
        { ...event, skipped_rebuild: true },
        { status: 200 },
      );
    }

    const withPayload = await buildDigestPayload(event.id);
    return NextResponse.json(withPayload, { status: 200 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

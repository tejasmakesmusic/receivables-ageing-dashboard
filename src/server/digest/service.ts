import "server-only";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { HttpError } from "@/server/core/errors";
import { digest_event_state } from "@/generated/prisma/enums";

export interface DigestEventListQuery {
  state?: digest_event_state;
  page?: number;
  page_size?: number;
}

/**
 * List digest events — Admin only. Caller must already have enforced
 * requireRole(ADMIN) before reaching this service.
 */
export async function listDigestEvents(query: DigestEventListQuery) {
  const { state, page = 1, page_size = 50 } = query;

  const where = { ...(state ? { state } : {}) };

  const [items, total] = await getPrisma().$transaction([
    getPrisma().digest_events.findMany({
      where,
      orderBy: { digest_date: "desc" },
      skip: (page - 1) * page_size,
      take: page_size,
    }),
    getPrisma().digest_events.count({ where }),
  ]);

  return { items, total, page, page_size };
}

export async function getDigestEvent(id: string) {
  const event = await getPrisma().digest_events.findUnique({ where: { id } });

  if (!event) {
    throw new HttpError("not_found", 404, "Digest event not found");
  }

  return event;
}

/**
 * Idempotent upsert of a DRAFT digest event for the given date (YYYY-MM-DD).
 * If an event already exists for that date, returns it unchanged.
 * Called by the Vercel cron and by admin "trigger manually".
 */
export async function triggerDigestForDate(
  digestDate: string, // YYYY-MM-DD
  triggeredBy: string, // reserved for future audit rows
) {
  void triggeredBy; // actor recorded by approveDigest/skipDigest later
  const dateVal = new Date(digestDate);

  // Idempotency: return existing event if any state
  const existing = await getPrisma().digest_events.findUnique({
    where: { digest_date: dateVal },
  });
  if (existing) {
    return existing;
  }

  const id = createId();
  const now = new Date();

  return getPrisma().digest_events.create({
    data: {
      id,
      digest_date: dateVal,
      state: digest_event_state.DRAFT,
      snapshot_ids: [],
      created_at: now,
      updated_at: now,
    },
  });
}

/**
 * Build the digest payload from current DB state and transition DRAFT → PREVIEWED.
 * Safe to re-run on PREVIEWED events (rebuilds payload in place).
 */
export async function buildDigestPayload(digestId: string) {
  const event = await getPrisma().digest_events.findUnique({
    where: { id: digestId },
  });
  if (!event) {
    throw new HttpError("not_found", 404, "Digest event not found");
  }
  if (
    event.state !== digest_event_state.DRAFT &&
    event.state !== digest_event_state.PREVIEWED
  ) {
    throw new HttpError(
      "invalid_state",
      422,
      `Cannot build payload for digest in state ${event.state}`,
    );
  }

  const digestDate = event.digest_date;

  // ── Latest published snapshot per entity ───────────────────────────────
  const latestSnapshots = await getPrisma().snapshots.findMany({
    where: { status: "PUBLISHED" },
    orderBy: { as_of_date: "desc" },
    distinct: ["entity_id"],
    select: { id: true, entity_id: true, as_of_date: true },
  });

  const snapshotIds = latestSnapshots.map((s) => s.id);

  // ── AR totals per entity from invoice_snapshots ─────────────────────────
  const bucketGroups = snapshotIds.length > 0
    ? await getPrisma().invoice_snapshots.groupBy({
        by: ["bucket"],
        where: { snapshot_id: { in: snapshotIds }, outstanding_amount: { gt: 0 } },
        _sum: { outstanding_amount: true },
      })
    : [];

  // ── Open collection tasks by reason_code (grouped by reason_code only) ───
  // Group by reason_code only so counts are aggregated across all open statuses
  const taskGroups = await getPrisma().collection_tasks.groupBy({
    by: ["reason_code"],
    where: {
      status: { in: ["OPEN", "IN_PROGRESS", "SUGGESTED"] },
    },
    _count: { id: true },
  });

  // ── PTPs updated today (IST day boundary = UTC+05:30) ────────────────────
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+05:30
  const digestMs = digestDate.getTime();
  const istMidnightUtc = digestMs - (digestMs % 86_400_000) - IST_OFFSET_MS;
  const ptpStats = await getPrisma().promises_to_pay.groupBy({
    by: ["status"],
    where: {
      updated_at: {
        gte: new Date(istMidnightUtc),
        lte: new Date(istMidnightUtc + 86_400_000 - 1),
      },
    },
    _count: { id: true },
  });

  // ── Total outstanding ────────────────────────────────────────────────────
  const totalOutstanding = bucketGroups.reduce((acc, g) => {
    return acc + Number(g._sum.outstanding_amount ?? 0);
  }, 0);

  const payload = {
    digest_date: digestDate.toISOString().slice(0, 10),
    total_outstanding_usd: totalOutstanding,
    bucket_breakdown: Object.fromEntries(
      bucketGroups.map((g) => [g.bucket, Number(g._sum.outstanding_amount ?? 0)]),
    ),
    // Summed across OPEN/IN_PROGRESS/SUGGESTED per reason code
    open_tasks_by_reason: Object.fromEntries(
      taskGroups.map((g) => [g.reason_code, g._count.id]),
    ),
    ptp_activity_today: Object.fromEntries(
      ptpStats.map((g) => [g.status, g._count.id]),
    ),
    snapshot_ids: snapshotIds,
    generated_at: new Date().toISOString(),
  };

  const updated = await getPrisma().digest_events.update({
    where: { id: digestId },
    data: {
      state: digest_event_state.PREVIEWED,
      payload_json: payload,
      snapshot_ids: snapshotIds,
      updated_at: new Date(),
    },
  });

  return updated;
}

/**
 * Admin approves the digest — PREVIEWED → APPROVED.
 * If the CFO digest email rule is active, enqueues to email_outbox.
 * Spec §D13 + §15: never send until rule is_active = true.
 */
export async function approveDigest(digestId: string, approvedBy: string) {
  const event = await getPrisma().digest_events.findUnique({
    where: { id: digestId },
  });
  if (!event) {
    throw new HttpError("not_found", 404, "Digest event not found");
  }
  if (event.state !== digest_event_state.PREVIEWED) {
    throw new HttpError(
      "invalid_state",
      422,
      `Cannot approve digest in state ${event.state} — must be PREVIEWED`,
    );
  }
  if (!event.payload_json) {
    throw new HttpError(
      "payload_missing",
      422,
      "Digest payload has not been built yet — trigger a build first",
    );
  }

  const now = new Date();
  const digestDateStr = event.digest_date.toISOString().slice(0, 10);

  // H5 fix: read email rule INSIDE the transaction so the is_active check
  // is atomic with the approve update — prevents TOCTOU race
  await getPrisma().$transaction(async (tx) => {
    const rule = await tx.email_rules.findUnique({
      where: { rule_type: "DAILY_DIGEST" },
    });

    await tx.digest_events.update({
      where: { id: digestId },
      data: {
        state: digest_event_state.APPROVED,
        approved_by: approvedBy,
        updated_at: now,
      },
    });

    // Enqueue email only if rule is active (spec §15: no email until Tejaswa enables rule)
    if (rule?.is_active) {
      const recipients = Array.isArray(rule.recipients_json)
        ? rule.recipients_json
        : JSON.parse(rule.recipients_json as string);

      await tx.email_outbox.create({
        data: {
          id: createId(),
          rule_type: "DAILY_DIGEST",
          subject: `EMB Receivables Digest — ${digestDateStr}`,
          body_html: buildDigestHtml(
            event.payload_json as Record<string, unknown>,
            digestDateStr,
          ),
          recipients_json: recipients,
          status: "QUEUED",
          enqueued_at: now,
        },
      });
    }

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: approvedBy,
        action: "digest_event.approve",
        entity_type: "digest_events",
        entity_id: digestId,
        before: { state: event.state },
        after: { state: digest_event_state.APPROVED, email_enqueued: rule?.is_active ?? false },
      },
    });
  });

  return getPrisma().digest_events.findUnique({ where: { id: digestId } });
}

/**
 * Admin skips the digest for a given date (won't be sent).
 */
export async function skipDigest(digestId: string, skippedBy: string) {
  const event = await getPrisma().digest_events.findUnique({
    where: { id: digestId },
  });
  if (!event) {
    throw new HttpError("not_found", 404, "Digest event not found");
  }
  // H4 fix: include FAILED in terminal states
  const terminalStates: digest_event_state[] = [
    digest_event_state.SENT,
    digest_event_state.SKIPPED,
    digest_event_state.FAILED,
  ];
  if (terminalStates.includes(event.state)) {
    throw new HttpError(
      "invalid_state",
      422,
      `Cannot skip digest already in state ${event.state}`,
    );
  }

  const now = new Date();

  await getPrisma().$transaction(async (tx) => {
    await tx.digest_events.update({
      where: { id: digestId },
      data: { state: digest_event_state.SKIPPED, updated_at: now },
    });

    // M5 fix: if already APPROVED, cancel the pending outbox row so the
    // email doesn't go out despite the admin skipping the digest
    if (event.state === digest_event_state.APPROVED) {
      await tx.email_outbox.updateMany({
        where: { rule_type: "DAILY_DIGEST", status: "QUEUED" },
        data: { status: "CANCELLED" },
      });
    }

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: skippedBy,
        action: "digest_event.skip",
        entity_type: "digest_events",
        entity_id: digestId,
        before: { state: event.state },
        after: { state: digest_event_state.SKIPPED },
      },
    });
  });

  return getPrisma().digest_events.findUnique({ where: { id: digestId } });
}

// ── HTML builder ──────────────────────────────────────────────────────────────

function buildDigestHtml(
  payload: Record<string, unknown>,
  digestDate: string,
): string {
  const buckets = (payload.bucket_breakdown ?? {}) as Record<string, number>;
  const tasks = (payload.open_tasks_by_reason ?? {}) as Record<string, number>;
  const ptps = (payload.ptp_activity_today ?? {}) as Record<string, number>;
  const total = Number(payload.total_outstanding_usd ?? 0);

  const bucketRows = Object.entries(buckets)
    .map(
      ([bucket, amount]) =>
        `<tr><td>${bucket}</td><td style="text-align:right">$${amount.toLocaleString()}</td></tr>`,
    )
    .join("");

  const taskRows = Object.entries(tasks)
    .map(
      ([code, count]) =>
        `<tr><td>${code.replace(/_/g, " ")}</td><td style="text-align:right">${count}</td></tr>`,
    )
    .join("");

  const ptpRows = Object.entries(ptps)
    .map(
      ([status, count]) =>
        `<tr><td>${status}</td><td style="text-align:right">${count}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
<h2>EMB Receivables Digest — ${digestDate}</h2>
<p><strong>Total outstanding:</strong> $${total.toLocaleString()}</p>

<h3>Ageing Buckets</h3>
<table width="100%" cellpadding="6" style="border-collapse:collapse">
  <thead><tr><th>Bucket</th><th>Outstanding</th></tr></thead>
  <tbody>${bucketRows || "<tr><td colspan='2'>No data</td></tr>"}</tbody>
</table>

<h3>Open Collection Tasks</h3>
<table width="100%" cellpadding="6" style="border-collapse:collapse">
  <thead><tr><th>Reason</th><th>Count</th></tr></thead>
  <tbody>${taskRows || "<tr><td colspan='2'>None</td></tr>"}</tbody>
</table>

<h3>PTP Activity Today</h3>
<table width="100%" cellpadding="6" style="border-collapse:collapse">
  <thead><tr><th>Status</th><th>Count</th></tr></thead>
  <tbody>${ptpRows || "<tr><td colspan='2'>None</td></tr>"}</tbody>
</table>

<hr/>
<p style="font-size:12px;color:#666">Generated by Receivables OS — ${new Date().toISOString()}</p>
</body></html>`;
}

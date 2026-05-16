import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export interface ExceptionTagRow {
  id: string;
  bucket_type_code: string;
  bucket_type_name: string;
  reason: string;
  tagged_at: string;
  tagged_by_email: string;
  status: string;
  expected_resolution_date: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface InvoiceSnapshotHistoryRow {
  as_of_date: string;
  snapshot_id: string;
  outstanding_amount: string;
  overdue_days: number;
  bucket: string;
}

export interface InvoiceDetailResponse {
  invoice_id: string;
  invoice_ref: string;
  invoice_date: string;
  amount: string;
  currency: string;
  due_date: string;
  credit_days_applied: number;
  credit_days_source: string;
  status: "OPEN" | "SETTLED";
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  first_seen_snapshot_id: string;
  settled_snapshot_id: string | null;
  exception_tags: ExceptionTagRow[];
  snapshot_history: InvoiceSnapshotHistoryRow[];
  /**
   * Spec §13.4: Tally ships its own `overdue_days` column. We don't use it
   * for ageing, but the UI must display it next to our calc with a tooltip
   * so analysts can cross-check. Captured from the latest snapshot's
   * `raw_row_json.overdue_days`. `null` for non-Tally sources (e.g. Xero)
   * or when the column was empty in the source row.
   */
  tally_overdue_days_latest: number | null;
}

export interface InvoiceListRow {
  invoice_id: string;
  invoice_ref: string;
  invoice_date: string;
  amount: string;
  currency: string;
  due_date: string;
  credit_days_applied: number;
  status: "OPEN" | "SETTLED";
  canonical_id: string;
  canonical_name: string;
  entity_code: string;
  overdue_days: number | null;
  bucket: string | null;
  active_exception_count: number;
  /** PR 9 — Line-of-Business tag, null when untagged. */
  lob_id: string | null;
  lob_code: string | null;
  lob_name: string | null;
  /**
   * True when the invoice was first observed in the most recent PUBLISHED
   * snapshot for its entity. Powers the "New since last upload" surface
   * (Gap 1 — snapshot continuity).
   */
  is_new_in_latest_snapshot: boolean;
  /**
   * True when the invoice was settled (closed) by the most recent PUBLISHED
   * snapshot for its entity. Powers the "Closed this snapshot" surface
   * (Gap 2 — snapshot continuity).
   */
  is_closed_in_latest_snapshot: boolean;
  /**
   * Number of unacknowledged invoice_changes rows tied to the latest
   * published snapshot. >0 means a field drift was captured for this
   * invoice in the most recent publish (Gap 3 — snapshot continuity).
   */
  unack_change_count_in_latest_snapshot: number;
}

export interface InvoiceListResponse {
  items: InvoiceListRow[];
  total: number;
  page: number;
  page_size: number;
}

export interface InvoiceListFilters {
  entity?: string;
  status?: string;
  overdue_bucket?: string;
  has_active_exceptions?: boolean;
  party_canonical_id?: string;
  /** PR 9 — filter by LOB code (case-insensitive). "__none__" → invoices with no LOB. */
  lob?: string;
  /**
   * "new"     — invoices whose first_seen_snapshot_id is the latest
   *             PUBLISHED snapshot for their entity.
   * "closed"  — invoices whose settled_snapshot_id is the latest PUBLISHED
   *             snapshot for their entity (settled-this-snapshot view).
   * "changed" — invoices with one or more UNACKNOWLEDGED invoice_changes
   *             rows tied to the latest PUBLISHED snapshot for their entity.
   * "all"     — no continuity filter (default).
   */
  change_status?: "new" | "closed" | "changed" | "all";
  page: number;
  page_size: number;
}

/**
 * Returns the latest PUBLISHED snapshot id per entity, scoped to the
 * caller's visible entities. Used by the "New since last upload" filter
 * and the per-row `is_new_in_latest_snapshot` flag.
 *
 * Excludes CREDIT_PERIOD snapshots — those don't upsert invoices.
 */
async function getLatestPublishedSnapshotIds(
  currentUser: AuthenticatedUser,
): Promise<string[]> {
  const prisma = getPrisma();
  const entityScope =
    currentUser.role === role_enum.ANALYST && currentUser.entityIdScope
      ? { entity_id: currentUser.entityIdScope }
      : {};

  const rows = await prisma.snapshots.groupBy({
    by: ["entity_id"],
    where: {
      ...entityScope,
      status: "PUBLISHED",
      source_hint: { not: "CREDIT_PERIOD" },
    },
    _max: { published_at: true },
  });

  const ids: string[] = [];
  for (const row of rows) {
    if (!row._max.published_at) continue;
    const latest = await prisma.snapshots.findFirst({
      where: {
        entity_id: row.entity_id,
        status: "PUBLISHED",
        source_hint: { not: "CREDIT_PERIOD" },
        published_at: row._max.published_at,
      },
      select: { id: true },
    });
    if (latest) ids.push(latest.id);
  }
  return ids;
}

type DecimalLike = string | number | null | { toString: () => string };

function formatDecimal(value: DecimalLike): string {
  if (value == null) return "0.00";
  if (typeof value === "number") return value.toFixed(2);
  return value.toString();
}

function toDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function toDateTime(value: Date): string {
  return value.toISOString();
}

/**
 * Spec §13.4: Tally exports an `overdue_days` column. We capture it into
 * `raw_row_json` at ingest time (see src/server/parsers/tally.ts) and
 * surface it next to our computed value on invoice detail. Non-Tally
 * sources (Xero etc.) don't write this key — return null. Blanks and
 * non-numeric strings also become null so the UI can hide the chip.
 */
function readTallyOverdueDays(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).overdue_days;
  if (value == null || value === "") return null;
  const numeric =
    typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

export async function getInvoiceDetail(
  invoiceId: string,
): Promise<InvoiceDetailResponse | null> {
  const prisma = getPrisma();

  const invoice = await prisma.invoices.findUnique({
    where: {
      id: invoiceId,
    },
    include: {
      parties_canonical: {
        select: {
          id: true,
          name: true,
        },
      },
      entities: {
        select: {
          code: true,
        },
      },
      exception_tags: {
        orderBy: {
          tagged_at: "desc",
        },
        include: {
          exception_bucket_types: {
            select: {
              code: true,
              name: true,
            },
          },
          users_exception_tags_tagged_byTousers: {
            select: {
              email: true,
            },
          },
        },
      },
      invoice_snapshots: {
        orderBy: {
          as_of_date: "desc",
        },
        select: {
          as_of_date: true,
          snapshot_id: true,
          outstanding_amount: true,
          overdue_days: true,
          bucket: true,
        },
      },
    },
  });

  if (!invoice) {
    return null;
  }

  const exceptionTags: ExceptionTagRow[] = invoice.exception_tags.map(
    (tag) => ({
      id: tag.id,
      bucket_type_code: tag.exception_bucket_types?.code ?? "",
      bucket_type_name: tag.exception_bucket_types?.name ?? "",
      reason: tag.reason,
      tagged_at: toDateTime(tag.tagged_at),
      tagged_by_email: tag.users_exception_tags_tagged_byTousers?.email ?? "",
      status: tag.status,
      expected_resolution_date: tag.expected_resolution_date
        ? toDateString(tag.expected_resolution_date)
        : null,
      resolved_at: tag.resolved_at ? toDateTime(tag.resolved_at) : null,
      resolution_note: tag.resolution_note ?? null,
    }),
  );

  const snapshotHistory: InvoiceSnapshotHistoryRow[] =
    invoice.invoice_snapshots.map((snapshot) => ({
      as_of_date: toDateString(snapshot.as_of_date),
      snapshot_id: snapshot.snapshot_id,
      outstanding_amount: formatDecimal(snapshot.outstanding_amount),
      overdue_days: snapshot.overdue_days,
      bucket: snapshot.bucket,
    }));

  // Spec §13.4: pull the source's `overdue_days` from the latest
  // raw_row_json so the invoice header can cross-display it.
  const tallyOverdueLatest = readTallyOverdueDays(invoice.raw_row_json);

  return {
    invoice_id: invoice.id,
    invoice_ref: invoice.invoice_ref,
    invoice_date: toDateString(invoice.invoice_date),
    amount: formatDecimal(invoice.amount),
    currency: invoice.currency,
    due_date: toDateString(invoice.due_date),
    credit_days_applied: invoice.credit_days_applied,
    credit_days_source: invoice.credit_days_source,
    status: invoice.status === "SETTLED" ? "SETTLED" : "OPEN",
    canonical_id: invoice.canonical_id,
    canonical_name:
      invoice.parties_canonical?.name ?? String(invoice.canonical_id),
    entity_code: invoice.entities?.code ?? "UNKNOWN",
    first_seen_snapshot_id: invoice.first_seen_snapshot_id,
    settled_snapshot_id: invoice.settled_snapshot_id,
    exception_tags: exceptionTags,
    snapshot_history: snapshotHistory,
    tally_overdue_days_latest: tallyOverdueLatest,
  };
}

export async function getInvoiceEntityId(
  invoiceId: string,
): Promise<string | null> {
  const invoice = await getPrisma().invoices.findUnique({
    where: { id: invoiceId },
    select: { entity_id: true },
  });

  return invoice?.entity_id ?? null;
}

export async function listInvoices(
  filters: InvoiceListFilters,
  currentUser: AuthenticatedUser,
): Promise<InvoiceListResponse> {
  const prisma = getPrisma();

  // Latest PUBLISHED snapshot per visible entity. Computed up-front because
  // it powers BOTH the "new" filter and the per-row `is_new_in_latest_snapshot`
  // badge.
  const latestSnapshotIds = await getLatestPublishedSnapshotIds(currentUser);
  const latestSnapshotIdSet = new Set(latestSnapshotIds);

  const where = {
    ...(currentUser.role === role_enum.ANALYST && currentUser.entityIdScope
      ? { entity_id: currentUser.entityIdScope }
      : {}),
    ...(filters.entity ? { entities: { is: { code: filters.entity } } } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.party_canonical_id
      ? { canonical_id: filters.party_canonical_id }
      : {}),
    ...(filters.has_active_exceptions === true
      ? { exception_tags: { some: { status: "ACTIVE" } } }
      : {}),
    ...(filters.has_active_exceptions === false
      ? { exception_tags: { none: { status: "ACTIVE" } } }
      : {}),
    ...(filters.lob
      ? filters.lob === "__none__"
        ? { lob_id: null }
        : {
            lobs: {
              is: {
                code: { equals: filters.lob, mode: "insensitive" as const },
              },
            },
          }
      : {}),
    ...(filters.change_status === "new"
      ? latestSnapshotIds.length === 0
        ? // No published snapshots yet → "new" filter must yield zero rows,
          // not the whole table. Use an impossible predicate.
          { id: { in: [] as string[] } }
        : { first_seen_snapshot_id: { in: latestSnapshotIds } }
      : {}),
    ...(filters.change_status === "closed"
      ? latestSnapshotIds.length === 0
        ? { id: { in: [] as string[] } }
        : {
            settled_snapshot_id: { in: latestSnapshotIds },
            status: "SETTLED",
          }
      : {}),
    ...(filters.change_status === "changed"
      ? latestSnapshotIds.length === 0
        ? { id: { in: [] as string[] } }
        : {
            invoice_changes: {
              some: {
                snapshot_id: { in: latestSnapshotIds },
                acknowledged_at: null,
              },
            },
          }
      : {}),
  };

  const [total, invoices] = await Promise.all([
    prisma.invoices.count({ where }),
    prisma.invoices.findMany({
      where,
      orderBy: { invoice_date: "desc" },
      skip: (filters.page - 1) * filters.page_size,
      take: filters.page_size,
      include: {
        parties_canonical: { select: { name: true } },
        entities: { select: { code: true } },
        lobs: { select: { code: true, name: true } },
        invoice_snapshots: {
          orderBy: { as_of_date: "desc" },
          take: 1,
          select: {
            overdue_days: true,
            bucket: true,
          },
        },
      },
    }),
  ]);

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const exceptionCounts = invoiceIds.length
    ? await prisma.exception_tags.groupBy({
        by: ["invoice_id"],
        where: {
          invoice_id: { in: invoiceIds },
          status: "ACTIVE",
        },
        _count: { invoice_id: true },
      })
    : [];
  const exceptionCountByInvoice = new Map<string, number>(
    exceptionCounts.map((row) => [row.invoice_id, row._count.invoice_id]),
  );

  // PR 3 / Gap 3 — count unacknowledged invoice_changes per invoice that
  // were detected in any of the latest snapshots. Powers the "Changed"
  // chip and the side-panel summary.
  const changeCounts =
    invoiceIds.length && latestSnapshotIds.length
      ? await prisma.invoice_changes.groupBy({
          by: ["invoice_id"],
          where: {
            invoice_id: { in: invoiceIds },
            snapshot_id: { in: latestSnapshotIds },
            acknowledged_at: null,
          },
          _count: { invoice_id: true },
        })
      : [];
  const changeCountByInvoice = new Map<string, number>(
    changeCounts.map((row) => [row.invoice_id, row._count.invoice_id]),
  );

  const items = invoices
    .map<InvoiceListRow>((invoice) => {
      const latestSnapshot = invoice.invoice_snapshots.at(0);

      return {
        invoice_id: invoice.id,
        invoice_ref: invoice.invoice_ref,
        invoice_date: toDateString(invoice.invoice_date),
        amount: formatDecimal(invoice.amount),
        currency: invoice.currency,
        due_date: toDateString(invoice.due_date),
        credit_days_applied: invoice.credit_days_applied,
        status: invoice.status === "SETTLED" ? "SETTLED" : "OPEN",
        canonical_id: invoice.canonical_id,
        canonical_name: invoice.parties_canonical?.name ?? "",
        entity_code: invoice.entities?.code ?? "",
        overdue_days: latestSnapshot?.overdue_days ?? null,
        bucket: latestSnapshot?.bucket ?? null,
        active_exception_count: exceptionCountByInvoice.get(invoice.id) ?? 0,
        is_new_in_latest_snapshot: latestSnapshotIdSet.has(
          invoice.first_seen_snapshot_id,
        ),
        is_closed_in_latest_snapshot:
          invoice.settled_snapshot_id != null &&
          latestSnapshotIdSet.has(invoice.settled_snapshot_id),
        unack_change_count_in_latest_snapshot:
          changeCountByInvoice.get(invoice.id) ?? 0,
        lob_id: invoice.lob_id,
        lob_code: invoice.lobs?.code ?? null,
        lob_name: invoice.lobs?.name ?? null,
      };
    })
    .filter((invoice) =>
      filters.overdue_bucket ? invoice.bucket === filters.overdue_bucket : true,
    );

  return {
    items,
    total,
    page: filters.page,
    page_size: filters.page_size,
  };
}

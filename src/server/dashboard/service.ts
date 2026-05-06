import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import {
  DashboardError,
  type DashboardBucket,
  type DashboardEntity,
  type DashboardRequest,
  type DashboardResponse,
} from "./types";

const DASHBOARD_BUCKETS: readonly DashboardBucket[] = [
  "NOT_DUE",
  "0_30",
  "31_60",
  "61_90",
  "90_PLUS",
];

const BUCKET_SEVERITY: Record<DashboardBucket, number> = {
  NOT_DUE: 1,
  "0_30": 2,
  "31_60": 3,
  "61_90": 4,
  "90_PLUS": 5,
};

type RawSnapshotRow = {
  id: string;
  as_of_date: Date | null;
  status: string;
  entity_id: string;
  code: string;
  base_currency: string;
};

type RawInvoiceSnapshotRow = {
  canonical_id: string | null;
  outstanding_amount: unknown;
  bucket: string | null;
  currency: string | null;
  invoice_date: Date | null;
  credit_days_source: string | null;
};

type RawPartyRow = {
  id: string;
  name: string;
};

type RawExceptionCountRow = {
  canonical_id: string;
  active_exception_count: unknown;
};

type RawRecentExceptionRow = {
  exception_id: string;
  invoice_id: string;
  invoice_ref: string;
  canonical_name: string;
  bucket_type_code: string;
  bucket_type_name: string;
  tagged_at: Date | null;
  expected_resolution_date: Date | null;
};

type RawFxRateRow = {
  rate: unknown;
};

type InvoiceSnapshotRow = {
  canonical_id: string;
  outstanding_amount: number;
  bucket: DashboardBucket;
  currency: string;
  invoice_date: Date;
  credit_days_source: string;
};

type TopPartyAggregate = {
  canonical_id: string;
  outstanding: number;
  bucket: DashboardBucket;
};

function parseAsOfDate(value: string): Date | "latest" {
  if (!value || value === "latest") {
    return "latest";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DashboardError(422, {
      code: "INVALID_AS_OF",
      message: "as_of must be 'latest' or ISO date YYYY-MM-DD.",
    });
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new DashboardError(422, {
      code: "INVALID_AS_OF",
      message: "as_of must be 'latest' or ISO date YYYY-MM-DD.",
    });
  }

  return parsed;
}

function toDateValue(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value.slice(0, 10);
  }

  return value.toISOString().slice(0, 10);
}

function toNumber(value: unknown): number {
  if (value == null) {
    return 0;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof (value as { toNumber?: () => number }).toNumber === "function") {
    return Number((value as { toNumber: () => number }).toNumber());
  }

  return Number.parseFloat(String(value));
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function normalizeBucket(value: string | null): DashboardBucket {
  if (
    value === "NOT_DUE" ||
    value === "0_30" ||
    value === "31_60" ||
    value === "61_90" ||
    value === "90_PLUS"
  ) {
    return value;
  }

  return "NOT_DUE";
}

function normalizeEntity(value: string | null): DashboardEntity {
  if (value === "IND" || value === "UAE" || value === "ALL") {
    return value;
  }

  throw new DashboardError(422, {
    code: "INVALID_ENTITY",
    message: "entity must be one of IND, UAE, ALL.",
  });
}

async function resolveSnapshot(
  entityCode: DashboardEntity,
  asOf: Date | "latest",
): Promise<RawSnapshotRow> {
  const prisma = getPrisma();
  const rows =
    asOf === "latest"
      ? await prisma.$queryRaw<RawSnapshotRow[]>`
          SELECT
            s.id,
            s.as_of_date,
            s.status,
            s.entity_id,
            e.code,
            e.base_currency
          FROM snapshots s
          JOIN entities e ON e.id = s.entity_id
          WHERE
            e.code = ${entityCode}
            AND s.status = 'PUBLISHED'
            AND s.as_of_date IS NOT NULL
            AND s.source_hint IN ('TALLY', 'XERO')
          ORDER BY s.as_of_date DESC, s.published_at DESC
          LIMIT 1
        `
      : await prisma.$queryRaw<RawSnapshotRow[]>`
          SELECT
            s.id,
            s.as_of_date,
            s.status,
            s.entity_id,
            e.code,
            e.base_currency
          FROM snapshots s
          JOIN entities e ON e.id = s.entity_id
          WHERE
            e.code = ${entityCode}
            AND s.status = 'PUBLISHED'
            AND s.as_of_date = ${asOf}
            AND s.source_hint IN ('TALLY', 'XERO')
          LIMIT 1
        `;

  if (rows.length === 0) {
    throw new DashboardError(404, {
      code: "SNAPSHOT_NOT_FOUND",
      message: `No published snapshot found for entity '${entityCode}'.`,
    });
  }

  return rows[0];
}

async function getInvoiceSnapshotRows(
  snapshotId: string,
  asOfDate: string,
): Promise<InvoiceSnapshotRow[]> {
  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<RawInvoiceSnapshotRow[]>`
    SELECT
      i.canonical_id,
      isnap.outstanding_amount,
      isnap.bucket,
      i.currency,
      i.invoice_date,
      i.credit_days_source
    FROM invoice_snapshots isnap
    JOIN invoices i ON i.id = isnap.invoice_id
    WHERE
      isnap.snapshot_id = ${snapshotId}
      AND isnap.as_of_date = ${asOfDate}
  `;

  return rows
    .map((row) => {
      const canonicalId = row.canonical_id;
      const bucket = normalizeBucket(row.bucket);
      const invoiceDate = row.invoice_date;
      const currency = row.currency;
      const creditDaysSource = row.credit_days_source;

      if (!canonicalId || !invoiceDate || !currency || !creditDaysSource) {
        return null;
      }

      return {
        canonical_id: canonicalId,
        outstanding_amount: toNumber(row.outstanding_amount),
        bucket,
        currency,
        invoice_date: invoiceDate,
        credit_days_source: creditDaysSource,
      };
    })
    .filter((row): row is InvoiceSnapshotRow => row !== null);
}

async function getPartyNames(
  canonicalIds: string[],
): Promise<Map<string, string>> {
  const prisma = getPrisma();
  const names = new Map<string, string>();

  if (canonicalIds.length === 0) {
    return names;
  }

  const rows = await prisma.$queryRaw<RawPartyRow[]>`
    SELECT id, name
    FROM parties_canonical
    WHERE id IN (${Prisma.join(canonicalIds)})
  `;

  for (const row of rows) {
    names.set(row.id, row.name);
  }

  return names;
}

async function getActiveExceptionCountsByParty(
  canonicalIds: string[],
): Promise<Map<string, number>> {
  const prisma = getPrisma();
  const counts = new Map<string, number>();

  if (canonicalIds.length === 0) {
    return counts;
  }

  const rows = await prisma.$queryRaw<RawExceptionCountRow[]>`
    SELECT
      i.canonical_id,
      COUNT(et.id) AS active_exception_count
    FROM exception_tags et
    JOIN invoices i ON i.id = et.invoice_id
    WHERE
      i.canonical_id IN (${Prisma.join(canonicalIds)})
      AND et.status = 'ACTIVE'
    GROUP BY i.canonical_id
  `;

  for (const row of rows) {
    counts.set(row.canonical_id, toNumber(row.active_exception_count));
  }

  return counts;
}

async function getRecentExceptionsForEntities(
  entityIds: string[],
): Promise<RecentExceptions> {
  if (entityIds.length === 0) {
    return [];
  }

  const prisma = getPrisma();
  const rows = await prisma.$queryRaw<RawRecentExceptionRow[]>`
    SELECT
      et.id AS exception_id,
      et.invoice_id,
      i.invoice_ref,
      pc.name AS canonical_name,
      ebt.code AS bucket_type_code,
      ebt.name AS bucket_type_name,
      et.tagged_at,
      et.expected_resolution_date
    FROM exception_tags et
    JOIN exception_bucket_types ebt ON ebt.id = et.bucket_type_id
    JOIN invoices i ON i.id = et.invoice_id
    JOIN parties_canonical pc ON pc.id = i.canonical_id
    WHERE
      i.entity_id IN (${Prisma.join(entityIds)})
      AND et.status = 'ACTIVE'
    ORDER BY et.tagged_at DESC
    LIMIT 5
  `;

  return rows.map((row) => ({
    exception_id: row.exception_id,
    invoice_id: row.invoice_id,
    invoice_ref: row.invoice_ref,
    canonical_name: row.canonical_name,
    bucket_type_code: row.bucket_type_code,
    bucket_type_name: row.bucket_type_name,
    tagged_at: toDateValue(row.tagged_at) ?? new Date().toISOString(),
    expected_resolution_date: row.expected_resolution_date
      ? toDateValue(row.expected_resolution_date)
      : null,
  }));
}

async function getRecentExceptions(
  entityId: string,
): Promise<RecentExceptions> {
  return getRecentExceptionsForEntities([entityId]);
}

type RecentExceptions = DashboardResponse["recent_exceptions"];

function getTopParties(
  aggregates: TopPartyAggregate[],
  partyNames: Map<string, string>,
  exceptionCounts: Map<string, number>,
): DashboardResponse["top_parties"] {
  const ordered = new Map<string, number>();
  const worstBucket = new Map<string, DashboardBucket>();

  for (const item of aggregates) {
    const previous = ordered.get(item.canonical_id) ?? 0;
    ordered.set(item.canonical_id, previous + item.outstanding);

    const currentBucket = worstBucket.get(item.canonical_id);
    if (
      currentBucket === undefined ||
      BUCKET_SEVERITY[item.bucket] > BUCKET_SEVERITY[currentBucket]
    ) {
      worstBucket.set(item.canonical_id, item.bucket);
    }
  }

  const sorted = [...ordered.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return sorted.map(([canonicalId, outstanding]) => ({
    canonical_id: canonicalId,
    canonical_name: partyNames.get(canonicalId) ?? canonicalId,
    outstanding: round2(outstanding),
    overdue_bucket: worstBucket.get(canonicalId) ?? "NOT_DUE",
    active_exception_count: exceptionCounts.get(canonicalId) ?? 0,
  }));
}

async function lookupFxRate(
  fromCcy: string,
  toCcy: string,
  invoiceDate: Date,
  cache: Map<string, number>,
): Promise<number> {
  if (fromCcy === toCcy) {
    return 1;
  }

  const invoiceDateText = toDateValue(invoiceDate);
  if (!invoiceDateText) {
    throw new DashboardError(422, {
      code: "FX_RATE_MISSING",
      message: `No FX rate found for ${fromCcy}->${toCcy}.`,
      from_ccy: fromCcy,
      to_ccy: toCcy,
    });
  }

  const cacheKey = `${fromCcy}:${toCcy}:${invoiceDateText}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const rows = await getPrisma().$queryRaw<RawFxRateRow[]>`
    SELECT rate
    FROM fx_rates
    WHERE
      from_ccy = ${fromCcy}
      AND to_ccy = ${toCcy}
      AND effective_from <= ${invoiceDate}
    ORDER BY effective_from DESC
    LIMIT 1
  `;

  if (rows.length === 0) {
    throw new DashboardError(422, {
      code: "FX_RATE_MISSING",
      message: `No FX rate found for ${fromCcy}->${toCcy} covering ${invoiceDateText}.`,
      from_ccy: fromCcy,
      to_ccy: toCcy,
    });
  }

  const rate = toNumber(rows[0].rate);
  cache.set(cacheKey, rate);
  return rate;
}

async function resolveConsolidatedReferenceSnapshot(
  asOf: Date | "latest",
): Promise<RawSnapshotRow> {
  const rows =
    asOf === "latest"
      ? await getPrisma().$queryRaw<RawSnapshotRow[]>`
          SELECT
            s.id,
            s.as_of_date,
            s.status,
            s.entity_id,
            e.code,
            e.base_currency
          FROM snapshots s
          JOIN entities e ON e.id = s.entity_id
          WHERE
            e.code IN ('IND', 'UAE')
            AND s.status = 'PUBLISHED'
            AND s.as_of_date IS NOT NULL
            AND s.source_hint IN ('TALLY', 'XERO')
          ORDER BY s.as_of_date DESC, s.published_at DESC
          LIMIT 1
        `
      : await getPrisma().$queryRaw<RawSnapshotRow[]>`
          SELECT
            s.id,
            s.as_of_date,
            s.status,
            s.entity_id,
            e.code,
            e.base_currency
          FROM snapshots s
          JOIN entities e ON e.id = s.entity_id
          WHERE
            e.code IN ('IND', 'UAE')
            AND s.status = 'PUBLISHED'
            AND s.as_of_date = ${asOf}
            AND s.source_hint IN ('TALLY', 'XERO')
          ORDER BY s.published_at DESC
          LIMIT 1
        `;

  if (rows.length === 0) {
    throw new DashboardError(404, {
      code: "SNAPSHOT_NOT_FOUND",
      message:
        "No published receivables snapshots found for consolidated dashboard.",
    });
  }

  return rows[0];
}

async function resolveEntitySnapshotForConsolidated(
  entityCode: "IND" | "UAE",
  asOfDate: string,
): Promise<RawSnapshotRow | null> {
  const exactRows = await getPrisma().$queryRaw<RawSnapshotRow[]>`
    SELECT
      s.id,
      s.as_of_date,
      s.status,
      s.entity_id,
      e.code,
      e.base_currency
    FROM snapshots s
    JOIN entities e ON e.id = s.entity_id
    WHERE
      e.code = ${entityCode}
      AND s.status = 'PUBLISHED'
      AND s.as_of_date = ${asOfDate}
      AND s.source_hint IN ('TALLY', 'XERO')
    ORDER BY s.published_at DESC
    LIMIT 1
  `;

  if (exactRows.length > 0) {
    return exactRows[0];
  }

  const fallbackRows = await getPrisma().$queryRaw<RawSnapshotRow[]>`
    SELECT
      s.id,
      s.as_of_date,
      s.status,
      s.entity_id,
      e.code,
      e.base_currency
    FROM snapshots s
    JOIN entities e ON e.id = s.entity_id
    WHERE
      e.code = ${entityCode}
      AND s.status = 'PUBLISHED'
      AND s.as_of_date IS NOT NULL
      AND s.source_hint IN ('TALLY', 'XERO')
    ORDER BY s.as_of_date DESC, s.published_at DESC
    LIMIT 1
  `;

  return fallbackRows[0] ?? null;
}

async function getDashboardForEntity(
  entityCode: DashboardEntity,
  asOf: Date | "latest",
): Promise<DashboardResponse> {
  const snapshot = await resolveSnapshot(entityCode, asOf);
  const asOfDate = toDateValue(snapshot.as_of_date);

  if (!asOfDate) {
    throw new DashboardError(404, {
      code: "SNAPSHOT_NOT_FOUND",
      message: `No published snapshot found for entity '${entityCode}'.`,
    });
  }

  const rows = await getInvoiceSnapshotRows(snapshot.id, asOfDate);

  const ageBuckets: Record<DashboardBucket, number> = {
    NOT_DUE: 0,
    "0_30": 0,
    "31_60": 0,
    "61_90": 0,
    "90_PLUS": 0,
  };

  const defaultCanonicalIds = new Set<string>();
  const partyAggregates: TopPartyAggregate[] = [];
  let totalOutstanding = 0;
  let overdueTotal = 0;

  for (const row of rows) {
    const amount = round2(row.outstanding_amount);
    ageBuckets[row.bucket] = round2((ageBuckets[row.bucket] ?? 0) + amount);
    totalOutstanding = round2(totalOutstanding + amount);

    if (row.bucket !== "NOT_DUE") {
      overdueTotal = round2(overdueTotal + amount);
    }

    partyAggregates.push({
      canonical_id: row.canonical_id,
      outstanding: amount,
      bucket: row.bucket,
    });

    if (row.credit_days_source === "DEFAULT") {
      defaultCanonicalIds.add(row.canonical_id);
    }
  }

  const uniqueCanonicalIds = [
    ...new Set(partyAggregates.map((row) => row.canonical_id)),
  ];
  const partyNames = await getPartyNames(uniqueCanonicalIds);
  const exceptionCounts =
    await getActiveExceptionCountsByParty(uniqueCanonicalIds);
  const topParties = getTopParties(
    partyAggregates,
    partyNames,
    exceptionCounts,
  );
  const recentExceptions = await getRecentExceptions(snapshot.entity_id);

  const parties90Plus = new Set(
    partyAggregates
      .filter((row) => row.bucket === "90_PLUS")
      .map((row) => row.canonical_id),
  ).size;

  const pctOverdue =
    totalOutstanding > 0 ? round2((overdueTotal / totalOutstanding) * 100) : 0;

  return {
    entity: entityCode,
    as_of_date: asOfDate,
    snapshot_id: snapshot.id,
    snapshot_status: snapshot.status,
    currency_display: (snapshot.base_currency === "INR" ? "INR" : "AED") as
      | "INR"
      | "AED",
    kpis: {
      total_outstanding: totalOutstanding,
      pct_overdue: pctOverdue,
      parties_with_90plus_count: parties90Plus,
      last_snapshot_date: asOfDate,
      fx_rate_used: null,
    },
    ageing_buckets: DASHBOARD_BUCKETS.reduce(
      (acc, bucket) => ({ ...acc, [bucket]: ageBuckets[bucket] }),
      { NOT_DUE: 0, "0_30": 0, "31_60": 0, "61_90": 0, "90_PLUS": 0 },
    ),
    top_parties: topParties,
    recent_exceptions: recentExceptions,
    parties_on_default_credit_period_count: defaultCanonicalIds.size,
  };
}

async function getConsolidatedDashboard(
  asOf: Date | "latest",
): Promise<DashboardResponse> {
  const reference = await resolveConsolidatedReferenceSnapshot(asOf);
  const referenceAsOfDate = toDateValue(reference.as_of_date);

  if (!referenceAsOfDate) {
    throw new DashboardError(404, {
      code: "SNAPSHOT_NOT_FOUND",
      message:
        "No published receivables snapshots found for consolidated dashboard.",
    });
  }

  const ageBuckets: Record<DashboardBucket, number> = {
    NOT_DUE: 0,
    "0_30": 0,
    "31_60": 0,
    "61_90": 0,
    "90_PLUS": 0,
  };
  const defaultCanonicalIds = new Set<string>();
  const partyAggregates: TopPartyAggregate[] = [];
  const entityIds: string[] = [];
  const rateCache = new Map<string, number>();
  let totalOutstanding = 0;
  let overdueTotal = 0;
  let lastFxRate: number | null = null;

  for (const entityCode of ["IND", "UAE"] as const) {
    const snapshot = await resolveEntitySnapshotForConsolidated(
      entityCode,
      referenceAsOfDate,
    );
    if (!snapshot) {
      continue;
    }

    entityIds.push(snapshot.entity_id);
    const snapshotAsOfDate = toDateValue(snapshot.as_of_date);
    if (!snapshotAsOfDate) {
      continue;
    }

    const rows = await getInvoiceSnapshotRows(snapshot.id, snapshotAsOfDate);
    for (const row of rows) {
      const rate = await lookupFxRate(
        row.currency,
        "INR",
        row.invoice_date,
        rateCache,
      );
      if (row.currency !== "INR") {
        lastFxRate = rate;
      }

      const amount = round2(row.outstanding_amount * rate);
      ageBuckets[row.bucket] = round2((ageBuckets[row.bucket] ?? 0) + amount);
      totalOutstanding = round2(totalOutstanding + amount);

      if (row.bucket !== "NOT_DUE") {
        overdueTotal = round2(overdueTotal + amount);
      }

      partyAggregates.push({
        canonical_id: row.canonical_id,
        outstanding: amount,
        bucket: row.bucket,
      });

      if (row.credit_days_source === "DEFAULT") {
        defaultCanonicalIds.add(row.canonical_id);
      }
    }
  }

  const uniqueCanonicalIds = [
    ...new Set(partyAggregates.map((row) => row.canonical_id)),
  ];
  const partyNames = await getPartyNames(uniqueCanonicalIds);
  const exceptionCounts =
    await getActiveExceptionCountsByParty(uniqueCanonicalIds);
  const topParties = getTopParties(
    partyAggregates,
    partyNames,
    exceptionCounts,
  );
  const recentExceptions = await getRecentExceptionsForEntities(entityIds);
  const parties90Plus = new Set(
    partyAggregates
      .filter((row) => row.bucket === "90_PLUS")
      .map((row) => row.canonical_id),
  ).size;
  const pctOverdue =
    totalOutstanding > 0 ? round2((overdueTotal / totalOutstanding) * 100) : 0;

  return {
    entity: "ALL",
    as_of_date: referenceAsOfDate,
    snapshot_id: reference.id,
    snapshot_status: reference.status,
    currency_display: "INR",
    kpis: {
      total_outstanding: totalOutstanding,
      pct_overdue: pctOverdue,
      parties_with_90plus_count: parties90Plus,
      last_snapshot_date: referenceAsOfDate,
      fx_rate_used: lastFxRate,
    },
    ageing_buckets: DASHBOARD_BUCKETS.reduce(
      (acc, bucket) => ({ ...acc, [bucket]: ageBuckets[bucket] }),
      { NOT_DUE: 0, "0_30": 0, "31_60": 0, "61_90": 0, "90_PLUS": 0 },
    ),
    top_parties: topParties,
    recent_exceptions: recentExceptions,
    parties_on_default_credit_period_count: defaultCanonicalIds.size,
  };
}

export async function getDashboard(
  request: DashboardRequest,
): Promise<DashboardResponse> {
  const entity = normalizeEntity(request.entity);
  const asOf = parseAsOfDate(request.as_of);

  if (entity === "ALL") {
    return getConsolidatedDashboard(asOf);
  }

  return getDashboardForEntity(entity, asOf);
}

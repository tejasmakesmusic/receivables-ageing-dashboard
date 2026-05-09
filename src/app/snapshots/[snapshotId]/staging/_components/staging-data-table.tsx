"use client";

import Link from "next/link";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";
import { SavedViewLink, SavedViewTabs } from "@/components/ui/workspace";
import { formatCurrency, formatDate } from "@/lib/format";
import type {
  PublishGate,
  StagingCreditPeriodRow,
  StagingInvoiceRow,
} from "@/server/snapshots/service";
import { StagingRowActions } from "./staging-row-actions";

type StagingRow = StagingInvoiceRow | StagingCreditPeriodRow;

function isInvoiceRow(row: StagingRow): row is StagingInvoiceRow {
  return "party_name_raw" in row;
}

function rowName(row: StagingRow) {
  return isInvoiceRow(row) ? row.party_name_raw : row.name;
}

function rowResolutionState(row: StagingRow): string {
  if (row.analyst_overrides.resolved_canonical_id) return "RESOLVED";
  if (!isInvoiceRow(row)) return "EXACT";
  if (row.status === "PARSE_ERROR") {
    return row.analyst_overrides.dismissed ? "DISMISSED" : "PARSE_ERROR";
  }
  return row.alias_resolution.resolutionState;
}

const FILTER_TABS = [
  { label: "All", value: "all" },
  { label: "Unmapped", value: "unmapped" },
  { label: "Fuzzy High", value: "fuzzy_high" },
  { label: "Fuzzy Low", value: "fuzzy_low" },
  { label: "Parse Errors", value: "parse_error" },
  { label: "Resolved", value: "ok" },
] as const;

function filterHref(
  snapshotId: string,
  filter: string,
  offset: number,
  limit: number,
) {
  const params = new URLSearchParams({
    filter,
    offset: String(offset),
    limit: String(limit),
  });
  return `/snapshots/${snapshotId}/staging?${params.toString()}`;
}

type Props = {
  snapshotId: string;
  currency: string;
  rows: StagingRow[];
  activeFilter: string;
  gate: PublishGate;
  totalRows: number;
  filteredTotal: number;
  offset: number;
  limit: number;
};

export function StagingDataTable({
  snapshotId,
  currency,
  rows,
  activeFilter,
  gate,
  totalRows,
  filteredTotal,
  offset,
  limit,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(filteredTotal / limit));
  const currentPage = Math.floor(offset / limit) + 1;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;

  const columns: DataTableColumn<StagingRow>[] = [
    {
      key: "row",
      header: "#",
      width: "w-[52px]",
      cell: (row) => (
        <span className="tabular-nums text-[var(--color-text-subtle)]">
          {row.row_index}
        </span>
      ),
    },
    {
      key: "party",
      header: "Party / Name",
      sticky: "left",
      width: "min-w-[220px]",
      cell: (row) => {
        const state = rowResolutionState(row);
        const candidate = isInvoiceRow(row)
          ? row.alias_resolution.topMatches[0]
          : null;
        const gstin = isInvoiceRow(row) ? row.gstin : null;
        return (
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--color-text)]">
              {rowName(row)}
            </div>
            {gstin ? (
              <div className="truncate font-mono text-[11px] text-[var(--color-text-subtle)]">
                {gstin}
              </div>
            ) : null}
            {candidate && state !== "RESOLVED" && state !== "DISMISSED" ? (
              <div className="truncate text-xs text-[var(--color-text-muted)]">
                → {candidate.canonicalName}
              </div>
            ) : null}
          </div>
        );
      },
    },
    {
      key: "invoice",
      header: "Invoice",
      cell: (row) => (
        <span className="font-mono text-[13px] text-[var(--color-text-muted)]">
          {isInvoiceRow(row) ? (row.invoice_ref ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      cell: (row) => (
        <span className="tabular-nums text-[var(--color-text-muted)]">
          {isInvoiceRow(row) ? (formatDate(row.invoice_date) ?? "—") : "—"}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {isInvoiceRow(row) && row.amount
            ? formatCurrency(row.amount, currency)
            : "—"}
        </span>
      ),
    },
    {
      key: "match",
      header: "Match",
      cell: (row) => <StatusTag status={rowResolutionState(row)} />,
    },
    {
      key: "actions",
      header: "Action",
      width: "min-w-[230px]",
      cell: (row) => <StagingRowActions row={row} snapshotId={snapshotId} />,
    },
  ];

  return (
    <>
      <SavedViewTabs>
        {FILTER_TABS.map(({ label, value }) => {
          let count: number | null = null;
          if (value === "all") count = totalRows;
          else if (value === "unmapped") count = gate.unmapped_parties_count;
          else if (value === "fuzzy_high") count = gate.fuzzy_high_pending_count;
          else if (value === "fuzzy_low") count = gate.fuzzy_low_pending_count;
          else if (value === "parse_error")
            count = gate.parse_errors_unresolved_count;

          return (
            <SavedViewLink
              active={activeFilter === value}
              href={filterHref(snapshotId, value, 0, limit)}
              key={value}
            >
              {label}
              {count !== null ? (
                <span className="ml-1.5 rounded-full bg-current/10 px-1.5 py-0.5 text-[10px] tabular-nums">
                  {count}
                </span>
              ) : null}
            </SavedViewLink>
          );
        })}
      </SavedViewTabs>

      <DataTable<StagingRow>
        columns={columns}
        emptyState={{
          title: "No rows match this filter",
          description: "Switch to a different filter tab to see rows.",
        }}
        minWidthClass="min-w-[960px]"
        rowKey={(row) => String(row.row_index)}
        rows={rows}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-[var(--color-text-muted)]">
        <span>
          Showing {filteredTotal === 0 ? 0 : offset + 1}–
          {Math.min(offset + limit, filteredTotal)} of {filteredTotal}
          {activeFilter !== "all" ? " (filtered)" : ""}
        </span>
        <div className="flex items-center gap-2">
          <Link
            aria-disabled={offset <= 0}
            className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            href={filterHref(snapshotId, activeFilter, prevOffset, limit)}
          >
            Previous
          </Link>
          <span className="px-1 tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <Link
            aria-disabled={nextOffset >= filteredTotal}
            className="inline-flex h-9 items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            href={filterHref(snapshotId, activeFilter, nextOffset, limit)}
          >
            Next
          </Link>
        </div>
      </div>
    </>
  );
}

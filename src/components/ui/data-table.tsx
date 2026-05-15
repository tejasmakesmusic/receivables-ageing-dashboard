import type { ReactNode } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import {
  TABLE_ROW_INTERACTIVE_CLASS,
  TABLE_ROW_SELECTED_CLASS,
} from "./table-row-styles";
import { DataTableRow } from "./data-table-row";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

export type DataTableSort = {
  key: string;
  direction: "asc" | "desc";
};

export type DataTableDensity = "compact" | "default" | "comfortable";

export type DataTableColumn<Row> = {
  key: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  align?: "left" | "right" | "center";
  sticky?: "left";
  sortKey?: string;
  className?: string;
  headerClassName?: string;
  width?: string;
};

type StateActionConfig = {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
};

export type DataTableProps<Row> = {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowHref?: (row: Row) => string | null | undefined;
  rowCreateHref?: (row: Row) => string | null | undefined;
  rowEditHref?: (row: Row) => string | null | undefined;
  selectedRowKey?: string | null;
  sort?: DataTableSort;
  sortHref?: (sort: DataTableSort) => string;
  state?: "ready" | "loading" | "error";
  emptyState?: StateActionConfig;
  filteredEmptyState?: StateActionConfig;
  isFiltered?: boolean;
  errorState?: StateActionConfig;
  className?: string;
  minWidthClass?: string;
  loadingRowCount?: number;
  density?: DataTableDensity;
  filterBar?: ReactNode;
  toolbar?: ReactNode;
  selectable?: boolean;
  selectionName?: string;
  selectedRowKeys?: string[];
  bulkActions?: ReactNode;
};

const densityClasses: Record<DataTableDensity, { row: string; cell: string }> = {
  compact: {
    row: "h-[var(--density-row-compact)]",
    cell: "px-3 py-1.5",
  },
  default: {
    row: "h-[var(--density-row-default)]",
    cell: "px-3 py-2",
  },
  comfortable: {
    row: "h-[var(--density-row-comfortable)]",
    cell: "px-4 py-3",
  },
};

export function TableShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]",
        className,
      )}
    >
      <div className="relative">
        <div className="overflow-x-auto">{children}</div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[var(--color-surface)] to-transparent xl:hidden"
        />
      </div>
    </div>
  );
}

export function EmptyTableRow({
  children,
  colSpan,
}: {
  children: ReactNode;
  colSpan: number;
}) {
  return (
    <tr>
      <td
        className="px-4 py-10 text-center text-[13px] text-[var(--color-text-muted)]"
        colSpan={colSpan}
      >
        {children}
      </td>
    </tr>
  );
}

function alignClass(align: DataTableColumn<unknown>["align"]) {
  if (align === "right") return "text-right";
  if (align === "center") return "text-center";
  return "text-left";
}

function stickyClasses(sticky: DataTableColumn<unknown>["sticky"]) {
  if (sticky === "left") {
    return "sticky left-0 z-[1] border-r border-[var(--color-border)] bg-[var(--color-surface)]";
  }
  return "";
}

function EmptyIllustration() {
  return (
    <div
      aria-hidden="true"
      className="relative h-16 w-24 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-bg)]"
    >
      <div className="absolute left-3 right-3 top-3 h-2 rounded bg-[var(--color-bg-muted)]" />
      <div className="absolute left-3 right-8 top-7 h-2 rounded bg-[var(--color-bg-muted)]" />
      <div className="absolute bottom-3 left-3 h-2 w-10 rounded bg-[var(--color-accent-soft)]" />
    </div>
  );
}

function StateBlock({
  colSpan,
  config,
}: {
  colSpan: number;
  config: StateActionConfig;
}) {
  return (
    <tr>
      <td className="px-4 py-16" colSpan={colSpan}>
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 text-center">
          {config.icon ? (
            <div
              aria-hidden="true"
              className="grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
            >
              {config.icon}
            </div>
          ) : (
            <EmptyIllustration />
          )}
          <h3 className="text-[14px] font-semibold text-[var(--color-text)]">
            {config.title}
          </h3>
          <p className="max-w-sm text-[13px] text-[var(--color-text-muted)]">
            {config.description}
          </p>
          {config.action ? <div className="mt-1">{config.action}</div> : null}
        </div>
      </td>
    </tr>
  );
}

function SortGlyph({
  active,
  direction,
}: {
  active: boolean;
  direction: "asc" | "desc";
}) {
  return (
    <span aria-hidden="true" className="ml-1 text-[10px] text-[var(--color-text-subtle)]">
      {!active ? "-" : direction === "asc" ? "^" : "v"}
    </span>
  );
}

function nextSortDirection(
  current: DataTableSort | undefined,
  key: string,
): "asc" | "desc" {
  if (!current || current.key !== key) return "asc";
  return current.direction === "asc" ? "desc" : "asc";
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  rowHref,
  rowCreateHref,
  rowEditHref,
  selectedRowKey,
  sort,
  sortHref,
  state = "ready",
  emptyState,
  filteredEmptyState,
  isFiltered,
  errorState,
  className,
  minWidthClass = "min-w-[1024px]",
  loadingRowCount = 6,
  density = "default",
  filterBar,
  toolbar,
  selectable = false,
  selectionName = "selected_rows",
  selectedRowKeys = [],
  bulkActions,
}: DataTableProps<Row>) {
  const selectionSet = new Set(selectedRowKeys);
  const colCount = columns.length + (selectable ? 1 : 0);
  const densityClass = densityClasses[density];
  const selectedCount = selectedRowKeys.length;

  return (
    <div className="relative">
      {(filterBar || toolbar) ? (
        <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {filterBar}
          </div>
          {toolbar ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}

      <TableShell className={className}>
        <table className={cn("w-full text-[13px]", minWidthClass)}>
          <thead className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-bg-subtle)] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
            <tr className="h-[var(--density-header)]">
              {selectable ? (
                <th className="w-9 px-3 align-middle" scope="col">
                  <input
                    aria-label="Select all rows"
                    className="h-3.5 w-3.5 rounded border-[var(--color-border-strong)]"
                    type="checkbox"
                  />
                </th>
              ) : null}
              {columns.map((column) => {
                const sortable = Boolean(column.sortKey && sortHref);
                const active = sortable && sort?.key === column.sortKey;
                const headerInner = (
                  <span
                    className={cn(
                      "inline-flex items-center",
                      column.align === "right" && "justify-end",
                      column.align === "center" && "justify-center",
                    )}
                  >
                    {column.header}
                    {sortable ? (
                      <SortGlyph
                        active={Boolean(active)}
                        direction={active ? sort!.direction : "asc"}
                      />
                    ) : null}
                  </span>
                );

                return (
                  <th
                    className={cn(
                      "px-3 align-middle",
                      alignClass(column.align),
                      stickyClasses(column.sticky),
                      column.sticky ? "z-[2] bg-[var(--color-bg-subtle)]" : "",
                      column.headerClassName,
                      column.width,
                    )}
                    key={column.key}
                    scope="col"
                  >
                    {sortable && column.sortKey ? (
                      <Link
                        aria-sort={
                          active
                            ? sort!.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                        className="inline-flex items-center text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                        href={sortHref!({
                          key: column.sortKey,
                          direction: nextSortDirection(sort, column.sortKey),
                        })}
                      >
                        {headerInner}
                      </Link>
                    ) : (
                      headerInner
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {state === "loading" ? (
              Array.from({ length: loadingRowCount }).map((_, idx) => (
                <tr className={densityClass.row} key={`loading-${idx}`}>
                  {selectable ? <td className={densityClass.cell} /> : null}
                  {columns.map((column) => (
                    <td
                      className={cn(
                        densityClass.cell,
                        stickyClasses(column.sticky),
                        column.className,
                      )}
                      key={column.key}
                    >
                      <span className="block h-3 w-full max-w-[160px] animate-pulse rounded bg-[var(--color-bg-muted)]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : state === "error" ? (
              <StateBlock
                colSpan={colCount}
                config={
                  errorState ?? {
                    title: "Something went wrong",
                    description:
                      "We couldn't load this view. Refresh to try again.",
                  }
                }
              />
            ) : rows.length === 0 ? (
              <StateBlock
                colSpan={colCount}
                config={
                  (isFiltered && filteredEmptyState) ||
                  emptyState || {
                    title: "Nothing to show",
                    description: "There's no data for the current view.",
                  }
                }
              />
            ) : (
              rows.map((row) => {
                const key = rowKey(row);
                const href = rowHref?.(row) ?? undefined;
                const createHref = rowCreateHref?.(row) ?? undefined;
                const editHref = rowEditHref?.(row) ?? undefined;
                const selected = selectedRowKey === key;
                const checked = selectionSet.has(key);

                return (
                  <DataTableRow
                    className={cn(
                      "group",
                      densityClass.row,
                      TABLE_ROW_INTERACTIVE_CLASS,
                      href ? "cursor-pointer" : "",
                      selected && TABLE_ROW_SELECTED_CLASS,
                    )}
                    createHref={createHref}
                    dataRowKey={key}
                    editHref={editHref}
                    href={href}
                    key={key}
                  >
                    {selectable ? (
                      <td className={cn("w-9", densityClass.cell)}>
                        <input
                          aria-label={`Select row ${key}`}
                          className="h-3.5 w-3.5 rounded border-[var(--color-border-strong)]"
                          defaultChecked={checked}
                          name={selectionName}
                          type="checkbox"
                          value={key}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        className={cn(
                          densityClass.cell,
                          "align-middle",
                          alignClass(column.align),
                          column.align === "right" && "font-mono tabular-nums",
                          stickyClasses(column.sticky),
                          selected && column.sticky === "left"
                            ? "bg-[var(--color-accent-soft)]"
                            : "",
                          column.className,
                        )}
                        key={column.key}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </DataTableRow>
                );
              })
            )}
          </tbody>
        </table>
      </TableShell>

      {bulkActions && selectedCount > 0 ? (
        <div className="pointer-events-none sticky bottom-3 z-20 mt-3 flex justify-center">
          <div className="pointer-events-auto flex min-h-10 items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 shadow-[var(--shadow-popover)]">
            <span className="text-[13px] font-medium text-[var(--color-text)]">
              {selectedCount} selected
            </span>
            <div className="flex items-center gap-2">{bulkActions}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

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
  /**
   * PR C+ — optional decorative icon shown in a soft accent circle above
   * the empty-state title. Plain text empty states feel terse on a wide
   * table; a small visual marker makes the surface feel intentional.
   */
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
        "overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      {/* PR C+ — mobile/tablet scroll affordance. The right-edge fade hints
          that there's more content sideways when the inner table is wider
          than the viewport (which happens on every list table below ~1100px).
          Sticky-left columns keep context while horizontally scrolling. */}
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
        className="px-4 py-10 text-center text-sm text-[var(--color-text-muted)]"
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
    return "sticky left-0 bg-[var(--color-surface)] z-[1] border-r border-[var(--color-border)]";
  }
  return "";
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
              className="grid h-12 w-12 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
            >
              {config.icon}
            </div>
          ) : null}
          <h3 className="text-base font-semibold text-[var(--color-text)]">
            {config.title}
          </h3>
          <p className="max-w-sm text-sm text-[var(--color-text-muted)]">
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
  if (!active) {
    return (
      <span aria-hidden="true" className="ml-1 text-[var(--color-text-subtle)]">
        ↕
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="ml-1 text-[var(--color-text)]">
      {direction === "asc" ? "↑" : "↓"}
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
}: DataTableProps<Row>) {
  const colCount = columns.length;

  return (
    <TableShell className={className}>
      <table className={cn("w-full text-sm", minWidthClass)}>
        <thead className="bg-[var(--color-bg-subtle)] text-left text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
          <tr>
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
                    "px-4 py-3 align-middle",
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
              <tr key={`loading-${idx}`}>
                {columns.map((column) => (
                  <td
                    className={cn(
                      "px-4 py-3",
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

              return (
                <DataTableRow
                  className={cn(
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
                  {columns.map((column) => (
                    <td
                      className={cn(
                        "px-4 py-3 align-middle",
                        alignClass(column.align),
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
  );
}

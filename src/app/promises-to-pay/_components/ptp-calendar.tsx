import Link from "next/link";
import type { ReactNode } from "react";
import { StatusTag } from "@/components/ui/status-tag";
import { Panel, PanelHeader } from "@/components/ui/workspace";
import { formatCurrency, formatDate } from "@/lib/format";

type PromiseStatus = "OPEN" | "KEPT" | "BROKEN" | "CANCELLED";

type CalendarPromise = {
  id: string;
  canonical_id: string;
  party_name: string;
  invoice_ref: string | null;
  promised_date: string;
  amount: string | number | { toString(): string };
  currency: string;
  status: PromiseStatus;
  contact_person: string | null;
};

export type PtpCalendarProps = {
  promises: CalendarPromise[];
  baseSearchParams?: Record<string, string | undefined>;
};

type CalendarSectionProps = {
  children: ReactNode;
  count: number;
  emptyCopy: string;
  title: string;
};

function dateKey(promise: CalendarPromise) {
  return promise.promised_date.slice(0, 10);
}

function sortByDateAscending(a: CalendarPromise, b: CalendarPromise) {
  return (
    dateKey(a).localeCompare(dateKey(b)) ||
    a.party_name.localeCompare(b.party_name) ||
    a.id.localeCompare(b.id)
  );
}

function sortByDateDescending(a: CalendarPromise, b: CalendarPromise) {
  return (
    dateKey(b).localeCompare(dateKey(a)) ||
    a.party_name.localeCompare(b.party_name) ||
    a.id.localeCompare(b.id)
  );
}

function countLabel(count: number) {
  return `${count} ${count === 1 ? "promise" : "promises"}`;
}

function promiseHref(
  promiseId: string,
  baseSearchParams: Record<string, string | undefined> = {},
) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(baseSearchParams)) {
    if (value && key !== "promise") {
      search.set(key, value);
    }
  }

  search.set("tab", "calendar");
  search.set("promise", promiseId);

  return `/promises-to-pay?${search.toString()}`;
}

function PromiseCard({
  baseSearchParams,
  promise,
}: {
  baseSearchParams?: Record<string, string | undefined>;
  promise: CalendarPromise;
}) {
  return (
    <Link
      className="block rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-bg-subtle)]"
      href={promiseHref(promise.id, baseSearchParams)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-sm font-semibold text-[var(--color-text)]">
          {promise.party_name}
        </div>
        <StatusTag status={`PTP_${promise.status}`} />
      </div>
      <div className="mt-2 font-mono text-xs text-[var(--color-text-muted)]">
        {promise.invoice_ref ?? "No linked invoice"}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span className="font-medium tabular-nums text-[var(--color-text)]">
          {formatCurrency(promise.amount.toString(), promise.currency)}
        </span>
        <span className="font-mono">{promise.currency}</span>
        <span aria-hidden="true">.</span>
        <span>{promise.contact_person || "No contact"}</span>
      </div>
    </Link>
  );
}

function CalendarSection({
  children,
  count,
  emptyCopy,
  title,
}: CalendarSectionProps) {
  return (
    <Panel>
      <PanelHeader
        action={
          <span className="rounded-full bg-[var(--color-bg-muted)] px-2 py-1 text-xs font-medium text-[var(--color-text-muted)]">
            {countLabel(count)}
          </span>
        }
        title={title}
      />
      <div className="space-y-3 p-4">
        {count > 0 ? (
          children
        ) : (
          <div className="rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-3 py-4 text-sm text-[var(--color-text-muted)]">
            {emptyCopy}
          </div>
        )}
      </div>
    </Panel>
  );
}

function groupByDate(promises: CalendarPromise[]) {
  const groups = new Map<string, CalendarPromise[]>();

  for (const promise of promises) {
    const key = dateKey(promise);
    groups.set(key, [...(groups.get(key) ?? []), promise]);
  }

  return [...groups.entries()];
}

export function PtpCalendar({ baseSearchParams, promises }: PtpCalendarProps) {
  const today = new Date().toISOString().slice(0, 10);
  const overdue = promises
    .filter((promise) => dateKey(promise) < today && promise.status === "OPEN")
    .sort(sortByDateDescending);
  const dueToday = promises
    .filter((promise) => dateKey(promise) === today)
    .sort(sortByDateAscending);
  const upcoming = promises
    .filter((promise) => dateKey(promise) > today)
    .sort(sortByDateAscending);

  return (
    <div className="space-y-4">
      <CalendarSection
        count={overdue.length}
        emptyCopy="No overdue promises in this view."
        title="Overdue"
      >
        {overdue.map((promise) => (
          <PromiseCard
            baseSearchParams={baseSearchParams}
            key={promise.id}
            promise={promise}
          />
        ))}
      </CalendarSection>

      <CalendarSection
        count={dueToday.length}
        emptyCopy="No promises due today."
        title="Due Today"
      >
        {dueToday.map((promise) => (
          <PromiseCard
            baseSearchParams={baseSearchParams}
            key={promise.id}
            promise={promise}
          />
        ))}
      </CalendarSection>

      <CalendarSection
        count={upcoming.length}
        emptyCopy="No upcoming promises in the current filters."
        title="Upcoming"
      >
        {groupByDate(upcoming).map(([date, promisesForDate]) => (
          <div className="space-y-2" key={date}>
            <h3 className="text-xs font-semibold text-[var(--color-text-muted)]">
              {formatDate(date)}
            </h3>
            <div className="space-y-3">
              {promisesForDate.map((promise) => (
                <PromiseCard
                  baseSearchParams={baseSearchParams}
                  key={promise.id}
                  promise={promise}
                />
              ))}
            </div>
          </div>
        ))}
      </CalendarSection>
    </div>
  );
}

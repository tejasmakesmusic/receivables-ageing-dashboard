import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

export type SidePanelProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  meta?: ReactNode;
  openFullPageHref?: string;
  openFullPageLabel?: string;
  nextAction?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function SidePanel({
  title,
  subtitle,
  status,
  meta,
  openFullPageHref,
  openFullPageLabel = "Open full record",
  nextAction,
  children,
  className,
}: SidePanelProps) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-[var(--color-text)]">
              {title}
            </h2>
            {status}
          </div>
          {subtitle ? (
            <div className="mt-1 truncate text-sm text-[var(--color-text-muted)]">
              {subtitle}
            </div>
          ) : null}
          {meta ? (
            <div className="mt-1 truncate text-xs text-[var(--color-text-subtle)]">
              {meta}
            </div>
          ) : null}
        </div>
        {openFullPageHref ? (
          <Link
            aria-label={openFullPageLabel}
            className="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            href={openFullPageHref}
          >
            {openFullPageLabel}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        ) : null}
      </header>

      <div className="flex-1 space-y-4 p-4">{children}</div>

      {nextAction ? (
        <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg-subtle)] px-4 py-3">
          {nextAction}
        </footer>
      ) : null}
    </section>
  );
}

export function SidePanelField({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-3">
      <div className="text-xs text-[var(--color-text-muted)]">{label}</div>
      <div className="mt-1 font-semibold text-[var(--color-text)]">
        {children}
      </div>
    </div>
  );
}

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight, X } from "lucide-react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

export function RecordPeek({
  children,
  className,
  closeHref,
  expandHref,
  meta,
  open,
  status,
  subtitle,
  title,
}: {
  children: ReactNode;
  className?: string;
  closeHref: string;
  expandHref: string;
  meta?: ReactNode;
  open: boolean;
  status?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  if (!open) return null;

  return (
    <aside
      aria-label="Record preview"
      className={cn(
        "fixed bottom-0 right-0 top-[var(--shell-topbar-height)] z-40 flex w-full max-w-[480px] flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]",
        "animate-in slide-in-from-right duration-[var(--duration-normal)] ease-[var(--ease-standard)]",
        className,
      )}
    >
      <header className="flex min-h-12 items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-[16px] font-semibold text-[var(--color-text)]">
              {title}
            </h2>
            {status}
          </div>
          {subtitle ? (
            <div className="mt-1 truncate text-[13px] text-[var(--color-text-muted)]">
              {subtitle}
            </div>
          ) : null}
          {meta ? (
            <div className="mt-1 truncate text-[12px] text-[var(--color-text-subtle)]">
              {meta}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Link
            aria-label="Open full record"
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-accent)]"
            href={expandHref}
            title="Open full record"
          >
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link
            aria-label="Close preview"
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]"
            href={closeHref}
            title="Close preview"
          >
            <X className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}

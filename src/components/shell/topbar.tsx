import Link from "next/link";
import { Building2, CalendarDays, FileClock } from "lucide-react";
import { GlobalCommandMenu } from "@/components/shell/global-command-menu";

export function Topbar() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
      <div className="flex min-w-0 flex-1 items-center">
        <GlobalCommandMenu />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <Link
          className="hidden h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)] lg:inline-flex"
          href="/reports"
        >
          <Building2 className="h-4 w-4 text-[var(--color-text-muted)]" />
          All Entities
        </Link>
        <Link
          className="hidden h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)] md:inline-flex"
          href="/snapshots"
        >
          <CalendarDays className="h-4 w-4 text-[var(--color-text-muted)]" />
          Latest Snapshot
        </Link>
        <Link
          className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 transition-colors hover:bg-[var(--color-bg-muted)]"
          href="/dashboard"
        >
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <FileClock className="h-4 w-4" />
          </div>
          <div className="hidden text-sm md:block">
            <div className="font-medium text-[var(--color-text)]">
              Live Workspace
            </div>
            <div className="text-xs text-[var(--color-text-muted)]">
              AR operations
            </div>
          </div>
        </Link>
      </div>
    </header>
  );
}

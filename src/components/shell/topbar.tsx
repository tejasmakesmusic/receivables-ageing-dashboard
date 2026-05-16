import Link from "next/link";
import { Bell, CalendarDays, LogOut } from "lucide-react";
import { Breadcrumb } from "@/components/shell/breadcrumb";
import { GlobalCommandMenu } from "@/components/shell/global-command-menu";
import { role_enum } from "@/generated/prisma/enums";
import { getCurrentUser } from "@/server/core/auth";
import { getPrisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

async function loadTopbarContext() {
  try {
    const user = await getCurrentUser();
    const prisma = getPrisma();

    const latestSnapshot = await prisma.snapshots.findFirst({
      where: {
        status: "PUBLISHED",
        source_hint: { not: "CREDIT_PERIOD" },
        ...(user.role === role_enum.ANALYST && user.entityIdScope
          ? { entity_id: user.entityIdScope }
          : {}),
      },
      orderBy: { published_at: "desc" },
      select: {
        id: true,
        as_of_date: true,
        entities: { select: { code: true } },
      },
    });

    return { user, latestSnapshot };
  } catch {
    return { user: null, latestSnapshot: null };
  }
}

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export async function Topbar() {
  const { user, latestSnapshot } = await loadTopbarContext();
  const initials = user ? initialsFor(user.name, user.email) : "?";

  return (
    <header className="flex h-[var(--shell-topbar-height)] shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Breadcrumb />
        <div className="min-w-[160px] max-w-[440px] flex-1">
          <GlobalCommandMenu />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {latestSnapshot ? (
          <Link
            className="hidden h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-[12px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] md:inline-flex"
            href={`/snapshots/${latestSnapshot.id}`}
            title="Open latest published snapshot"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{latestSnapshot.as_of_date ? formatDate(latestSnapshot.as_of_date.toISOString()) : "-"}</span>
            <span className="rounded-[var(--radius-xs)] bg-[var(--color-bg-muted)] px-1 font-mono text-[10px]">
              {latestSnapshot.entities.code}
            </span>
          </Link>
        ) : null}

        <Link
          aria-label="Notifications — digest events"
          className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]"
          href="/admin/digest"
          title="Recent digest events"
        >
          <Bell className="h-4 w-4" />
        </Link>

        {user ? (
          <div className="flex items-center gap-1 rounded-[var(--radius-sm)] px-1 py-0.5 hover:bg-[var(--color-bg-muted)]">
            <div
              aria-hidden="true"
              className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent-soft)] text-[12px] font-semibold text-[var(--color-accent)]"
            >
              {initials}
            </div>
            <div className="hidden max-w-28 text-[12px] leading-tight md:block">
              <div className="truncate font-medium text-[var(--color-text)]">
                {user.name || user.email.split("@")[0]}
              </div>
              <div className="truncate uppercase tracking-[0.08em] text-[10px] text-[var(--color-text-muted)]">
                {user.role}
              </div>
            </div>
            <Link
              aria-label="Sign out"
              className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
              href="/auth/logout"
              prefetch={false}
              title="Sign out"
            >
              <LogOut className="h-4 w-4" />
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}

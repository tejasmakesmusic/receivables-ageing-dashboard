import Link from "next/link";
import { CalendarDays, LogOut } from "lucide-react";
import { GlobalCommandMenu } from "@/components/shell/global-command-menu";
import { role_enum } from "@/generated/prisma/enums";
import { getCurrentUser } from "@/server/core/auth";
import { getPrisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";

// PR C — topbar polish.
// Was: three decorative chips ("All Entities", "Latest Snapshot", "Live
// Workspace · AR operations") that all pointed at fixed routes but looked
// interactive. Replaced with real, server-fetched data:
//   • Latest published snapshot chip (date · entity), linked to that
//     snapshot. Scoped per analyst's entity, all entities for CFO/Admin/
//     Reviewer.
//   • User pill — name, role badge, sign-out.
// When unauthenticated (e.g. /auth/* routes), the topbar gracefully
// renders just the command menu without crashing.

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

function roleAccent(role: string): string {
  if (role === "ADMIN") return "var(--color-accent)";
  if (role === "CFO") return "var(--color-status-warning-text)";
  if (role === "REVIEWER") return "var(--color-status-info-text)";
  return "var(--color-text-muted)";
}

export async function Topbar() {
  const { user, latestSnapshot } = await loadTopbarContext();
  const initials = user ? initialsFor(user.name, user.email) : "?";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6">
      <div className="flex min-w-0 flex-1 items-center">
        <GlobalCommandMenu />
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {latestSnapshot ? (
          <Link
            className="hidden h-10 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm font-medium text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg-muted)] md:inline-flex"
            href={`/snapshots/${latestSnapshot.id}`}
            title="Open the latest published snapshot"
          >
            <CalendarDays className="h-4 w-4 text-[var(--color-text-muted)]" />
            <span className="text-[var(--color-text-muted)]">
              Latest snapshot
            </span>
            <span className="text-[var(--color-text)]">
              {latestSnapshot.as_of_date
                ? formatDate(latestSnapshot.as_of_date.toISOString())
                : "—"}
            </span>
            <span className="rounded bg-[var(--color-bg-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
              {latestSnapshot.entities.code}
            </span>
          </Link>
        ) : null}

        {user ? (
          <div className="flex items-center gap-2 rounded-[var(--radius-md)] border border-transparent px-1 py-1 transition-colors hover:border-[var(--color-border)] hover:bg-[var(--color-bg-muted)]">
            <div
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]"
            >
              {initials}
            </div>
            <div className="hidden text-sm md:block">
              <div className="font-medium text-[var(--color-text)]">
                {user.name || user.email.split("@")[0]}
              </div>
              <div
                className="text-[11px] uppercase tracking-wide"
                style={{ color: roleAccent(user.role) }}
              >
                {user.role}
                {user.role === role_enum.CFO ||
                user.role === role_enum.REVIEWER
                  ? " · read-only"
                  : null}
              </div>
            </div>
            <Link
              aria-label="Sign out"
              className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
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

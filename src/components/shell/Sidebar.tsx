"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  FileText,
  Home,
  Inbox,
  Layers,
  PieChart,
  RefreshCw,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Target,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/dashboard", label: "Dashboard", icon: PieChart },
  { href: "/focus", label: "Focus Queue", icon: Target },
  { href: "/snapshots", label: "Snapshots", icon: Layers },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/parties", label: "Parties", icon: Building2 },
  { href: "/tasks", label: "Tasks", icon: Inbox },
  { href: "/promises-to-pay", label: "Promises", icon: CalendarClock },
  { href: "/dispute-cases", label: "Disputes", icon: AlertTriangle },
  { href: "/reconciliation", label: "Reconciliation", icon: RefreshCw },
  { href: "/workflows", label: "Workflows", icon: SlidersHorizontal },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin", label: "Admin", icon: Settings },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      <div className="flex h-16 items-center gap-3 border-b border-[var(--color-border)] px-5">
        <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--color-accent)] text-white">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[var(--color-text)]">
            Receivables OS
          </div>
          <div className="truncate text-xs text-[var(--color-text-muted)]">
            AR command center
          </div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Primary">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={[
                "my-1 flex h-10 items-center gap-3 rounded-[var(--radius-md)] px-3 text-sm transition-colors duration-150",
                active
                  ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
              ].join(" ")}
              href={href}
              key={href}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-[var(--color-border)] p-3">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-[10px] font-semibold text-white">
              EMB
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--color-text)]">
                EMB Global
              </div>
              <div className="truncate text-xs text-[var(--color-text-muted)]">
                Receivables workspace
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 text-xs text-[var(--color-text-subtle)]">
          Receivables OS
        </div>
      </div>
    </aside>
  );
}

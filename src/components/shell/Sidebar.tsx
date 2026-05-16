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
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Target,
} from "lucide-react";
import { role_enum } from "@/generated/prisma/enums";
import type { SVGProps } from "react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
type Role = (typeof role_enum)[keyof typeof role_enum];

type NavItem = {
  href: string;
  icon: IconType;
  label: string;
  allowedRoles: Role[];
};

type MeResponse = {
  user: {
    role: Role;
  };
};

const SURFACE_ROLES: Role[] = [
  role_enum.ANALYST,
  role_enum.CFO,
  role_enum.REVIEWER,
  role_enum.ADMIN,
];
const ADMIN_ROLES: Role[] = [role_enum.ADMIN];
const SIDEBAR_COLLAPSED_KEY = "receivables.sidebar.collapsed.v1";
const SIDEBAR_RECENT_KEY = "receivables.sidebar.nav-recent.v1";
const SIDEBAR_RECENT_MAX = 5;

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home, allowedRoles: SURFACE_ROLES },
  { href: "/dashboard", label: "Dashboard", icon: PieChart, allowedRoles: SURFACE_ROLES },
  { href: "/focus", label: "Focus Queue", icon: Target, allowedRoles: SURFACE_ROLES },
  { href: "/invoices", label: "Invoices", icon: FileText, allowedRoles: SURFACE_ROLES },
  { href: "/parties", label: "Customers", icon: Building2, allowedRoles: SURFACE_ROLES },
  { href: "/tasks", label: "Collections", icon: Inbox, allowedRoles: SURFACE_ROLES },
  { href: "/promises-to-pay", label: "Promises", icon: CalendarClock, allowedRoles: SURFACE_ROLES },
  { href: "/dispute-cases", label: "Disputes", icon: AlertTriangle, allowedRoles: SURFACE_ROLES },
  { href: "/reconciliation", label: "Reconciliation", icon: RefreshCw, allowedRoles: SURFACE_ROLES },
  { href: "/snapshots", label: "Snapshots", icon: Layers, allowedRoles: SURFACE_ROLES },
  { href: "/workflows", label: "Workflows", icon: SlidersHorizontal, allowedRoles: SURFACE_ROLES },
  { href: "/reports", label: "Reports", icon: BarChart3, allowedRoles: SURFACE_ROLES },
  { href: "/admin", label: "Settings", icon: Settings, allowedRoles: ADMIN_ROLES },
  { href: "/config/credit-periods", label: "Credit Periods", icon: SlidersHorizontal, allowedRoles: ADMIN_ROLES },
  { href: "/config/aliases", label: "Party Aliases", icon: Inbox, allowedRoles: ADMIN_ROLES },
  { href: "/admin/fx-rates", label: "FX Rates", icon: ShieldCheck, allowedRoles: ADMIN_ROLES },
  { href: "/admin/email-rules", label: "Email Rules", icon: ShieldCheck, allowedRoles: ADMIN_ROLES },
  { href: "/admin/exception-buckets", label: "Exception Buckets", icon: AlertTriangle, allowedRoles: ADMIN_ROLES },
  { href: "/admin/audit-log", label: "Audit Log", icon: FileText, allowedRoles: ADMIN_ROLES },
];

const FAVORITE_ITEMS: NavItem[] = [
  { href: "/invoices?overdue_bucket=90_PLUS", label: "Overdue 90+", icon: Star, allowedRoles: SURFACE_ROLES },
  { href: "/tasks?system_view=DUE_TODAY", label: "Due today", icon: Star, allowedRoles: SURFACE_ROLES },
  { href: "/tasks?system_view=BROKEN_PTP", label: "Broken promises", icon: Star, allowedRoles: SURFACE_ROLES },
];

const NAV_HREF_SET = new Set(NAV_ITEMS.map((item) => item.href));

function safeJsonList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
}

function resolveNavHref(pathname: string): string | null {
  if (pathname === "/") return "/";
  const exact = NAV_ITEMS.find((item) => item.href === pathname);
  if (exact) return exact.href;
  return NAV_ITEMS.find((item) => item.href !== "/" && pathname.startsWith(`${item.href}/`))?.href ?? null;
}

function readStoredRecent(): string[] {
  if (typeof window === "undefined") return [];
  return safeJsonList(window.localStorage.getItem(SIDEBAR_RECENT_KEY))
    .filter((href) => NAV_HREF_SET.has(href))
    .slice(0, SIDEBAR_RECENT_MAX);
}

function NavGroup({
  collapsed,
  items,
  label,
  pathname,
}: {
  collapsed: boolean;
  items: NavItem[];
  label: string;
  pathname: string;
}) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-1">
      {!collapsed ? (
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-subtle)]">
          {label}
        </div>
      ) : null}
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={[
              "group flex h-8 items-center rounded-[var(--radius-sm)] text-[13px] transition-colors",
              collapsed ? "justify-center px-0" : "gap-2 px-2",
              active
                ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
            ].join(" ")}
            href={item.href}
            key={item.href}
            title={collapsed ? item.label : undefined}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1",
  );
  const [recentHrefs, setRecentHrefs] = useState<string[]>(() =>
    readStoredRecent(),
  );
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinnedFavorites, setPinnedFavorites] = useState<NavItem[]>([]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    let active = true;

    async function fetchMe(): Promise<MeResponse | null> {
      const response = await fetch("/api/auth/me");
      if (!response.ok) return null;
      return (await response.json()) as MeResponse;
    }

    async function hydrateMe() {
      // Audit 2026-05-16: one retry guards against transient
      // failures stripping the Admin link until manual reload.
      for (let attempt = 0; attempt < 2 && active; attempt += 1) {
        try {
          const payload = await fetchMe();
          if (payload?.user?.role) {
            if (active) setUserRole(payload.user.role);
            return;
          }
        } catch {
          // fall through to retry
        }
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    }

    hydrateMe();
    return () => {
      active = false;
    };
  }, []);

  // Pull the user's pinned saved views and surface them as Favorites.
  // Falls back to hardcoded FAVORITE_ITEMS when nothing is pinned.
  useEffect(() => {
    if (!userRole) return;
    let active = true;

    async function loadPinned() {
      try {
        const response = await fetch("/api/views");
        if (!response.ok) return;
        const payload = (await response.json()) as {
          data?: Array<{
            view_id: string;
            surface: string;
            name: string;
            pinned: boolean;
          }>;
        };
        if (!active || !Array.isArray(payload?.data)) return;
        const pinned = payload.data
          .filter((v) => v.pinned)
          .slice(0, 6)
          .map((v) => ({
            href: `/${v.surface.replace(/_/g, "-")}?view_id=${v.view_id}`,
            label: v.name,
            icon: Star,
            allowedRoles: SURFACE_ROLES,
          }));
        setPinnedFavorites(pinned);
      } catch {
        // best effort
      }
    }

    loadPinned();
    return () => {
      active = false;
    };
  }, [userRole]);

  useEffect(() => {
    const surface = resolveNavHref(pathname);
    if (!surface) return;
    const nextRecentHrefs = [surface, ...readStoredRecent().filter((href) => href !== surface)].slice(0, SIDEBAR_RECENT_MAX);
    window.localStorage.setItem(SIDEBAR_RECENT_KEY, JSON.stringify(nextRecentHrefs));
    const frame = window.requestAnimationFrame(() => {
      setRecentHrefs(nextRecentHrefs);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [pathname]);

  const visibleItems = useMemo(() => {
    const roleFiltered = userRole
      ? NAV_ITEMS.filter((item) => item.allowedRoles.includes(userRole))
      : NAV_ITEMS;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return roleFiltered;
    return roleFiltered.filter((item) => `${item.label} ${item.href}`.toLowerCase().includes(normalizedQuery));
  }, [searchQuery, userRole]);

  const visibleByHref = useMemo(
    () => new Map(visibleItems.map((item) => [item.href, item] as const)),
    [visibleItems],
  );
  const recentItems = recentHrefs
    .map((href) => visibleByHref.get(href))
    .filter((item): item is NavItem => Boolean(item));
  const visibleFavorites =
    pinnedFavorites.length > 0
      ? pinnedFavorites.filter((item) => !userRole || item.allowedRoles.includes(userRole))
      : FAVORITE_ITEMS.filter((item) => !userRole || item.allowedRoles.includes(userRole));

  return (
    <aside
      className="hidden h-screen shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width] duration-[var(--duration-normal)] ease-[var(--ease-standard)] lg:flex"
      data-collapsed={collapsed ? "true" : "false"}
      style={{ width: collapsed ? "var(--shell-sidebar-collapsed)" : "var(--shell-sidebar-expanded)" }}
    >
      <div
        className={[
          "flex h-[var(--shell-topbar-height)] items-center border-b border-[var(--color-border)] px-2",
          collapsed ? "justify-center" : "gap-2",
        ].join(" ")}
      >
        {!collapsed ? (
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </div>
        ) : null}
        {!collapsed ? (
          <button
            className="min-w-0 flex-1 rounded-[var(--radius-sm)] px-1 py-0.5 text-left hover:bg-[var(--color-bg-muted)]"
            type="button"
          >
            <div className="truncate text-[13px] font-semibold text-[var(--color-text)]">EMB Global</div>
            <div className="truncate text-[12px] text-[var(--color-text-muted)]">Receivables workspace</div>
          </button>
        ) : null}
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] transition-colors",
            collapsed
              ? "border border-[var(--color-border)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-white"
              : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
          ].join(" ")}
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          type="button"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed ? (
        <div className="border-b border-[var(--color-border)] p-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-subtle)]" />
            <input
              aria-label="Filter navigation"
              className="h-8 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] py-1 pl-8 pr-2 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filter surfaces"
              value={searchQuery}
            />
          </label>
        </div>
      ) : null}

      <nav className="flex-1 space-y-4 overflow-y-auto p-2" aria-label="Primary">
        <NavGroup collapsed={collapsed} items={recentItems} label="Recent" pathname={pathname} />
        <NavGroup collapsed={collapsed} items={visibleItems} label="Workspace" pathname={pathname} />
        <NavGroup collapsed={collapsed} items={visibleFavorites} label="Favorites" pathname={pathname} />
      </nav>

      <div className="border-t border-[var(--color-border)] p-2">
        <Link
          className={[
            "flex h-8 items-center rounded-[var(--radius-sm)] text-[13px] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
            collapsed ? "justify-center" : "gap-2 px-2",
          ].join(" ")}
          href="/config"
          title={collapsed ? "Settings" : undefined}
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          {!collapsed ? <span>Settings</span> : null}
        </Link>
      </div>
    </aside>
  );
}

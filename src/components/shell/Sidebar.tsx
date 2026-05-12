"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  FileText,
  Globe2,
  Home,
  Inbox,
  Layers,
  PieChart,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  StarOff,
  Target,
} from "lucide-react";
import { role_enum } from "@/generated/prisma/enums";
import type { SVGProps } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
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

const SURFACE_ROLES: Role[] = [role_enum.ANALYST, role_enum.CFO, role_enum.ADMIN];
const ADMIN_ROLES: Role[] = [role_enum.ADMIN];

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Home", icon: Home, allowedRoles: SURFACE_ROLES },
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: PieChart,
    allowedRoles: SURFACE_ROLES,
  },
  { href: "/focus", label: "Focus Queue", icon: Target, allowedRoles: SURFACE_ROLES },
  {
    href: "/snapshots",
    label: "Snapshots",
    icon: Layers,
    allowedRoles: SURFACE_ROLES,
  },
  {
    href: "/invoices",
    label: "Invoices",
    icon: FileText,
    allowedRoles: SURFACE_ROLES,
  },
  {
    href: "/parties",
    label: "Parties",
    icon: Building2,
    allowedRoles: SURFACE_ROLES,
  },
  { href: "/tasks", label: "Tasks", icon: Inbox, allowedRoles: SURFACE_ROLES },
  {
    href: "/promises-to-pay",
    label: "Promises",
    icon: CalendarClock,
    allowedRoles: SURFACE_ROLES,
  },
  {
    href: "/dispute-cases",
    label: "Disputes",
    icon: AlertTriangle,
    allowedRoles: SURFACE_ROLES,
  },
  {
    href: "/reconciliation",
    label: "Reconciliation",
    icon: RefreshCw,
    allowedRoles: SURFACE_ROLES,
  },
  {
    href: "/workflows",
    label: "Workflows",
    icon: SlidersHorizontal,
    allowedRoles: SURFACE_ROLES,
  },
  { href: "/reports", label: "Reports", icon: BarChart3, allowedRoles: SURFACE_ROLES },
  { href: "/admin", label: "Admin", icon: Settings, allowedRoles: ADMIN_ROLES },
];

const SIDEBAR_ORDER_KEY = "receivables.sidebar.nav-order.v1";
const SIDEBAR_FAVORITES_KEY = "receivables.sidebar.nav-favorites.v1";
const SIDEBAR_RECENT_KEY = "receivables.sidebar.nav-recent.v1";
const SIDEBAR_RECENT_MAX = 6;
const DEFAULT_FAVORITES = ["/dashboard", "/focus", "/invoices", "/snapshots"];
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

function normalizeOrder(raw: string[]): string[] {
  const valid = raw.filter((href) => NAV_HREF_SET.has(href));
  const missing = NAV_ITEMS.map((item) => item.href).filter(
    (href) => !valid.includes(href),
  );
  return [...valid, ...missing];
}

function normalizeFavorites(raw: string[]): string[] {
  return raw.filter((href) => NAV_HREF_SET.has(href));
}

function resolveNavHref(pathname: string): string | null {
  if (pathname === "/") {
    return "/";
  }

  const exact = NAV_ITEMS.find((item) => item.href === pathname);
  if (exact) {
    return exact.href;
  }

  return (
    NAV_ITEMS.find(
      (item) => item.href !== "/" && pathname.startsWith(`${item.href}/`),
    )?.href ?? null
  );
}

function readStoredRecent(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  const stored = safeJsonList(window.localStorage.getItem(SIDEBAR_RECENT_KEY));
  return normalizeFavorites(stored).slice(0, SIDEBAR_RECENT_MAX);
}

function readStoredOrder(): string[] {
  if (typeof window === "undefined") {
    return NAV_ITEMS.map((item) => item.href);
  }

  const storedOrder = safeJsonList(window.localStorage.getItem(SIDEBAR_ORDER_KEY));
  return storedOrder.length > 0
    ? normalizeOrder(storedOrder)
    : NAV_ITEMS.map((item) => item.href);
}

function readStoredFavorites(): string[] {
  if (typeof window === "undefined") {
    return DEFAULT_FAVORITES;
  }

  const storedFavorites = safeJsonList(
    window.localStorage.getItem(SIDEBAR_FAVORITES_KEY),
  );
  if (!window.localStorage.getItem(SIDEBAR_FAVORITES_KEY)) {
    return DEFAULT_FAVORITES;
  }

  return normalizeFavorites(storedFavorites);
}

function buildNavItems(order: string[]): NavItem[] {
  const lookup = new Map(NAV_ITEMS.map((item) => [item.href, item] as const));
  return order
    .map((href) => lookup.get(href))
    .filter((item): item is NavItem => Boolean(item));
}

function resolveRecentHrefs(pathname: string | null): string[] {
  if (typeof window === "undefined" || !pathname) {
    return [];
  }

  const surface = resolveNavHref(pathname);
  if (!surface) {
    return [];
  }

  return [surface, ...readStoredRecent().filter((href) => href !== surface)].slice(
    0,
    SIDEBAR_RECENT_MAX,
  );
}

export function Sidebar() {
  const pathname = usePathname();
  // Initialize with server-safe defaults — localStorage is hydrated in useEffect
  // so SSR and the first client render always agree (no hydration mismatch).
  // PR C+ — hide the per-row reorder/pin controls behind an explicit
  // edit mode. They were always in the DOM (just opacity:0 until hover)
  // which polluted the accessibility tree with 3× the nav-item count in
  // "Move X up / Move X down / Pin X" buttons. Default off → clean
  // sidebar, clean a11y. Toggle in the sidebar header for power users.
  const [editMode, setEditMode] = useState(false);
  const [orderedHrefs, setOrderedHrefs] = useState<string[]>(() =>
    NAV_ITEMS.map((item) => item.href),
  );
  const [favoriteHrefs, setFavoriteHrefs] = useState<string[]>(DEFAULT_FAVORITES);
  const [recentHrefs, setRecentHrefs] = useState<string[]>([]);
  const [userRole, setUserRole] = useState<Role | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // isMounting prevents the localStorage-save effects from running before the
  // hydration effect has loaded the real stored values (first-mount flush).
  // The hydration effect is defined LAST, so it runs last in the first flush.
  const isMounting = useRef(true);

  useEffect(() => {
    if (isMounting.current) return; // skip until hydration effect has run
    window.localStorage.setItem(SIDEBAR_ORDER_KEY, JSON.stringify(orderedHrefs));
  }, [orderedHrefs]);

  useEffect(() => {
    if (isMounting.current) return; // skip until hydration effect has run
    window.localStorage.setItem(
      SIDEBAR_FAVORITES_KEY,
      JSON.stringify(favoriteHrefs),
    );
  }, [favoriteHrefs]);

  useEffect(() => {
    let active = true;

    async function hydrateMe() {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) return;

        const payload = (await response.json()) as MeResponse;
        if (active && payload?.user?.role) {
          setUserRole(payload.user.role);
        }
      } catch {
        // Non-blocking: role-sensitive nav is best-effort.
      }
    }

    hydrateMe();

    return () => {
      active = false;
    };
  }, []);

  // Track page visits and persist recents; also drives recentHrefs state so
  // the sidebar shows the correct "Recent" group without reading localStorage
  // inline during render (which caused the hydration mismatch).
  useEffect(() => {
    const nextRecentHrefs = resolveRecentHrefs(pathname);
    if (nextRecentHrefs.length === 0) return;

    window.localStorage.setItem(
      SIDEBAR_RECENT_KEY,
      JSON.stringify(nextRecentHrefs),
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentHrefs(nextRecentHrefs);
  }, [pathname]);

  // Hydrate localStorage state after mount — defined LAST so it runs after the
  // save effects in the same first-mount flush (they see isMounting = true and
  // skip their writes, preserving whatever the user had stored).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrderedHrefs(readStoredOrder());
    setFavoriteHrefs(readStoredFavorites());
    isMounting.current = false;
  }, []);

  const visibleNavItems = useMemo(() => {
    if (!userRole) return NAV_ITEMS;
    return NAV_ITEMS.filter((item) => item.allowedRoles.includes(userRole));
  }, [userRole]);

  const visibleSet = useMemo(
    () => new Set(visibleNavItems.map((item) => item.href)),
    [visibleNavItems],
  );

  const orderedNavItems = useMemo(() => {
    return buildNavItems(orderedHrefs).filter((item) => visibleSet.has(item.href));
  }, [orderedHrefs, visibleSet]);

  const recentNavItems = useMemo(() => {
    const visibleNavByHref = new Map(
      visibleNavItems.map((item) => [item.href, item] as const),
    );
    const mapped = recentHrefs
      .map((href) => visibleNavByHref.get(href))
      .filter((item): item is NavItem => Boolean(item));

    return mapped;
  }, [visibleNavItems, recentHrefs]);

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredNavItems = useMemo(() => {
    if (!normalizedQuery) return orderedNavItems;
    return orderedNavItems.filter((item) => {
      const haystack = `${item.label} ${item.href}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [orderedNavItems, normalizedQuery]);

  const favoriteItems = useMemo(
    () => filteredNavItems.filter((item) => favoriteHrefs.includes(item.href)),
    [filteredNavItems, favoriteHrefs],
  );
  const standardItems = useMemo(
    () => filteredNavItems.filter((item) => !favoriteHrefs.includes(item.href)),
    [filteredNavItems, favoriteHrefs],
  );

  function reorderNavItem(href: string, delta: -1 | 1) {
    setOrderedHrefs((current) => {
      const next = [...current];
      const index = next.indexOf(href);
      if (index < 0) return current;

      const target = index + delta;
      if (target < 0 || target >= next.length) return current;

      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleFavorite(href: string) {
    setFavoriteHrefs((current) => {
      if (current.includes(href)) {
        return current.filter((value) => value !== href);
      }
      return [...current, href];
    });
  }

  const renderGroup = (groupLabel: string, items: NavItem[]) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-1">
        <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-subtle)]">
          {groupLabel}
        </div>
        {items.map((item) => {
          const { href, icon: Icon, label } = item;
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          const isFavorite = favoriteHrefs.includes(href);
          const itemIndex = orderedHrefs.indexOf(href);
          const canMoveUp = itemIndex > 0;
          const canMoveDown = itemIndex >= 0 && itemIndex < orderedHrefs.length - 1;

          return (
            <div
              className="group my-1 flex h-10 items-center gap-2 rounded-[var(--radius-md)] transition-colors duration-150"
              key={href}
            >
              {editMode ? (
                <>
                  <div className="ml-1 flex h-full items-center gap-1">
                    <button
                      aria-label={`Move ${label} up`}
                      className="grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-35"
                      disabled={!canMoveUp}
                      onClick={() => reorderNavItem(href, -1)}
                      type="button"
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      aria-label={`Move ${label} down`}
                      className="grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-subtle)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)] disabled:cursor-not-allowed disabled:opacity-35"
                      disabled={!canMoveDown}
                      onClick={() => reorderNavItem(href, 1)}
                      type="button"
                    >
                      <ChevronDown
                        className="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <button
                    aria-label={isFavorite ? `Unpin ${label}` : `Pin ${label}`}
                    className="grid h-6 w-6 place-items-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]"
                    onClick={() => toggleFavorite(href)}
                    type="button"
                  >
                    {isFavorite ? (
                      <Star
                        className="h-3.5 w-3.5 fill-[var(--color-accent)] text-[var(--color-accent)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <StarOff className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </>
              ) : null}
              <Link
                aria-current={active ? "page" : undefined}
                className={[
                  "my-0 flex flex-1 items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm transition-colors duration-150",
                  active
                    ? "bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
                ].join(" ")}
                href={href}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{label}</span>
              </Link>
            </div>
          );
        })}
      </div>
    );
  };

  // PR C+ — hide the full 256px sidebar below the lg breakpoint
  // (1024px). On phones/tablets the layout would otherwise lose half
  // its width to nav chrome. Mobile users navigate via the topbar's
  // command palette (Ctrl+K / tap-to-open) which already lists every
  // surface.
  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)] lg:flex">
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

      <div className="space-y-2 border-b border-[var(--color-border)] px-3 py-2">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-subtle)]"
          />
          <input
            className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 pl-8 pr-3 text-sm text-[var(--color-text)] outline-none ring-[var(--color-border-medium)] focus:border-[var(--color-accent)] focus:ring-2"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Find a surface..."
            value={searchQuery}
          />
        </div>
        <div className="flex items-center justify-between px-2">
          <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-subtle)]">
            <Globe2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
            Navigation
          </span>
          <button
            aria-label={
              editMode ? "Finish reordering navigation" : "Reorder navigation"
            }
            className={[
              "rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide transition-colors",
              editMode
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "text-[var(--color-text-subtle)] hover:text-[var(--color-text)]",
            ].join(" ")}
            onClick={() => setEditMode((v) => !v)}
            type="button"
          >
            {editMode ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Primary">
        {renderGroup("Recent", recentNavItems)}
        {renderGroup("Pinned", favoriteItems)}
        {renderGroup(searchQuery.trim() ? "Search Results" : "All Surfaces", standardItems)}
        {filteredNavItems.length === 0 ? (
          <p className="px-2 py-6 text-xs text-[var(--color-text-muted)]">
            No matching surfaces
          </p>
        ) : null}
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

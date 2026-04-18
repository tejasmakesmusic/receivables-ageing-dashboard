import { Link, NavLink, Outlet, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";

const ENTITY_OPTIONS = [
  { code: "IND", label: "IND" },
  { code: "UAE", label: "UAE" },
];

const NAV_LINKS = [
  { to: "/dashboard", label: "Dashboard", roles: ["ANALYST", "CFO", "ADMIN"] as string[] },
  { to: "/upload", label: "Upload", roles: ["ANALYST", "ADMIN"] as string[] },
  { to: "/exceptions", label: "Exceptions", roles: ["ANALYST", "ADMIN"] as string[] },
  { to: "/config/credit-period", label: "Credit Periods", roles: ["ANALYST", "ADMIN"] as string[] },
  { to: "/config/aliases", label: "Aliases", roles: ["ANALYST", "ADMIN"] as string[] },
];

const ADMIN_LINKS = [
  { to: "/admin/exception-buckets", label: "Exception Buckets" },
  { to: "/admin/fx-rates", label: "FX Rates" },
  { to: "/admin/audit-log", label: "Audit Log" },
  { to: "/admin/emails", label: "Email Outbox" },
  { to: "/admin/reconciliation", label: "Reconciliation" },
  { to: "/admin/users", label: "Users" },
];

function roleBadgeVariant(role: string) {
  if (role === "ADMIN") return "info" as const;
  if (role === "CFO") return "warning" as const;
  if (role === "ANALYST") return "success" as const;
  return "neutral" as const;
}

export function Shell() {
  const { data: user } = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const entity = (searchParams.get("entity") ?? "IND") as "IND" | "UAE";

  function setEntity(code: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("entity", code);
      return next;
    });
  }

  async function handleLogout() {
    // Backend clears the session cookie on redirect; just navigate
    window.location.href = "/auth/logout";
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Top nav */}
      <header className="sticky top-0 z-40 border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-screen-xl items-center gap-4 px-4 py-2">
          {/* App name */}
          <Link to="/dashboard" className="text-sm font-bold text-blue-700 shrink-0">
            EMB Receivables
          </Link>

          {/* Main nav */}
          <nav className="flex items-center gap-1 overflow-x-auto" aria-label="Main navigation">
            {NAV_LINKS.filter((l) => !user || l.roles.includes(user.role)).map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap",
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-800",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
            {user?.role === "ADMIN" && (
              <details className="relative group">
                <summary className="cursor-pointer list-none rounded px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-800">
                  Admin ▾
                </summary>
                <div className="absolute left-0 top-full z-50 mt-1 w-44 rounded border border-gray-200 bg-white shadow-lg">
                  {ADMIN_LINKS.map((link) => (
                    <NavLink
                      key={link.to}
                      to={link.to}
                      className={({ isActive }) =>
                        cn(
                          "block px-3 py-2 text-xs text-slate-700 hover:bg-slate-50",
                          isActive && "font-semibold text-blue-700",
                        )
                      }
                      onClick={() => {
                        // Close the details on nav
                        const details = document.querySelector("details");
                        if (details) details.open = false;
                      }}
                    >
                      {link.label}
                    </NavLink>
                  ))}
                </div>
              </details>
            )}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Entity pills — shown in nav for quick switching */}
          <div className="flex items-center gap-1" role="group" aria-label="Entity selector">
            {ENTITY_OPTIONS.map((opt) => (
              <button
                key={opt.code}
                onClick={() => setEntity(opt.code)}
                aria-pressed={entity === opt.code}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  entity === opt.code
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 text-slate-600 hover:bg-gray-200",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* User info */}
          {user && (
            <div className="flex items-center gap-2 text-xs text-slate-500 shrink-0">
              <Badge variant={roleBadgeVariant(user.role)}>{user.role}</Badge>
              <span className="hidden sm:inline">{user.email}</span>
              <button
                onClick={handleLogout}
                className="rounded px-2 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Log out"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

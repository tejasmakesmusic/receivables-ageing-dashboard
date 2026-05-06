import Link from "next/link";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/upload", label: "Upload" },
  { href: "/invoices", label: "Invoices" },
  { href: "/snapshots", label: "Snapshots" },
  { href: "/exceptions", label: "Exceptions" },
  { href: "/follow-ups", label: "Follow-ups" },
  { href: "/api/reports/ageing", label: "Export" },
  { href: "/config", label: "Config" },
  { href: "/admin", label: "Admin" },
] as const;

export function AppNav() {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <Link
          className="text-sm font-semibold tracking-tight text-slate-900"
          href="/"
        >
          Receivables
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              className="rounded px-3 py-2 text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
          <Link
            className="rounded bg-slate-900 px-3 py-2 text-white hover:bg-slate-800"
            href="/auth/google/login"
          >
            Login
          </Link>
        </nav>
      </div>
    </header>
  );
}

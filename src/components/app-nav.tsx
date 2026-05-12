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
    <header className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
        <Link
          className="text-sm font-semibold tracking-tight text-[var(--color-text)]"
          href="/"
        >
          Receivables
        </Link>
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          {NAV_ITEMS.map((item) => (
            <Link
              className="rounded px-3 py-2 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]"
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
          <Link
            className="rounded bg-[var(--color-accent)] px-3 py-2 text-[var(--color-bg)] hover:bg-[var(--color-accent-strong)]"
            href="/auth/google/login"
          >
            Login
          </Link>
        </nav>
      </div>
    </header>
  );
}

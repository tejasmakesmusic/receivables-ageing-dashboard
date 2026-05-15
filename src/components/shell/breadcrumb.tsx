"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LABELS: Record<string, string> = {
  admin: "Admin",
  config: "Settings",
  dashboard: "Dashboard",
  "dispute-cases": "Disputes",
  exceptions: "Exceptions",
  focus: "Focus Queue",
  "follow-ups": "Follow-ups",
  invoice: "Invoices",
  invoices: "Invoices",
  parties: "Customers",
  party: "Customers",
  "promises-to-pay": "Promises",
  reconciliation: "Reconciliation",
  reports: "Reports",
  snapshots: "Snapshots",
  tasks: "Collections",
  upload: "Upload",
  workflows: "Workflows",
};

function labelFor(segment: string) {
  return LABELS[segment] ?? segment.replace(/-/g, " ");
}

export function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length === 0) {
    return (
      <nav aria-label="Breadcrumb" className="min-w-0 text-[13px]">
        <span className="font-medium text-[var(--color-text)]">Home</span>
      </nav>
    );
  }

  return (
    <nav aria-label="Breadcrumb" className="min-w-0 text-[13px]">
      <ol className="flex min-w-0 items-center gap-1 text-[var(--color-text-muted)]">
        <li>
          <Link className="hover:text-[var(--color-text)]" href="/">
            Home
          </Link>
        </li>
        {segments.map((segment, index) => {
          const href = `/${segments.slice(0, index + 1).join("/")}`;
          const current = index === segments.length - 1;
          const label = labelFor(segment);

          return (
            <li className="flex min-w-0 items-center gap-1" key={href}>
              <span aria-hidden="true" className="text-[var(--color-text-subtle)]">
                /
              </span>
              {current ? (
                <span className="truncate font-medium capitalize text-[var(--color-text)]">
                  {label}
                </span>
              ) : (
                <Link
                  className="truncate capitalize hover:text-[var(--color-text)]"
                  href={href}
                >
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModeToggle } from "@/components/mode-toggle";

const NAV_ITEMS = [
  { href: "/",             label: "Dashboard"    },
  { href: "/focus",        label: "Focus Queue"  },
  { href: "/collections",       label: "Collections"      },
  { href: "/promises-to-pay",  label: "Promises to Pay"  },
  { href: "/dispute-cases",    label: "Dispute Cases"    },
  { href: "/invoices",         label: "Invoices"         },
  { href: "/snapshots",    label: "Snapshots"    },
  { href: "/upload",       label: "Upload"       },
  { href: "/follow-ups",   label: "Follow-ups"   },
  { href: "/exceptions",   label: "Exceptions"   },
  { href: "/config",       label: "Config"       },
  { href: "/admin",        label: "Admin"        },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-52 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-subtle)]">
      {/* Wordmark */}
      <div className="flex h-12 items-center px-[var(--spacing-4)] border-b border-[var(--color-border)]">
        <span className="text-sm font-semibold tracking-tight text-[var(--color-text)]">
          Receivables OS
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-[var(--spacing-2)]">
        {NAV_ITEMS.map(({ href, label }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(href + "/");

          return (
            <Link
              key={href}
              href={href}
              className={[
                "flex items-center gap-[var(--spacing-2)] px-[var(--spacing-4)] py-[var(--spacing-2)]",
                "text-sm rounded-[var(--radius-sm)] mx-[var(--spacing-2)] my-px transition-colors",
                active
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)] font-medium"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
              ].join(" ")}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="flex items-center justify-between px-[var(--spacing-4)] py-[var(--spacing-3)] border-t border-[var(--color-border)]">
        <span className="text-xs text-[var(--color-text-subtle)]">EMB Global</span>
        <ModeToggle />
      </div>
    </aside>
  );
}

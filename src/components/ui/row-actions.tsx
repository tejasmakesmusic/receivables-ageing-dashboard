import Link from "next/link";
import { ExternalLink } from "lucide-react";

export function RowActionLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  return (
    <Link
      aria-label={label}
      className="inline-grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] border border-[var(--color-border)] text-[var(--color-text-muted)] opacity-0 transition-[border-color,color,opacity] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)] group-hover:opacity-100"
      href={href}
      title={label}
    >
      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

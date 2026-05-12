import type { HTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

export function PageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    // PR C+ — tighter padding on mobile (p-4 → ~16px each side) so 375px
    // phones don't waste a quarter of the viewport on chrome. p-6 (24px)
    // returns from sm: breakpoint upward.
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1680px] flex-col gap-5 p-4 sm:p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  actions,
  children,
  eyebrow,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  eyebrow?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="mb-1 text-xs text-[var(--color-text-muted)]">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">
          {title}
        </h1>
        {children ? (
          <div className="mt-1 text-sm text-[var(--color-text-muted)]">
            {children}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function Panel({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children?: ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
      <div>
        <h2 className="text-sm font-semibold text-[var(--color-text)]">
          {title}
        </h2>
        {children ? (
          <div className="mt-1 text-xs text-[var(--color-text-muted)]">
            {children}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  accent,
  label,
  meta,
  value,
}: {
  accent?: ReactNode;
  label: string;
  meta?: ReactNode;
  value: ReactNode;
}) {
  return (
    <Panel className="min-h-[118px] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-semibold text-[var(--color-text)]">
          {label}
        </div>
        {accent}
      </div>
      <div className="mt-5 text-2xl font-semibold text-[var(--color-text)]">
        {value}
      </div>
      {meta ? (
        <div className="mt-3 text-xs text-[var(--color-text-muted)]">
          {meta}
        </div>
      ) : null}
    </Panel>
  );
}

export function EmptyState({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] p-8 text-center">
      <h2 className="text-sm font-semibold text-[var(--color-text)]">
        {title}
      </h2>
      <p className="mt-2 max-w-md text-sm text-[var(--color-text-muted)]">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function SavedViewTabs({ children }: { children: ReactNode }) {
  return (
    <nav className="flex min-h-10 flex-wrap items-center gap-2 border-b border-[var(--color-border)]">
      {children}
    </nav>
  );
}

export function SavedViewLink({
  active,
  children,
  href,
}: {
  active?: boolean;
  children: ReactNode;
  href: string;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={[
        "inline-flex h-9 items-center rounded-[var(--radius-sm)] border px-3 text-sm transition-colors",
        active
          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent)]"
          : "border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
      ].join(" ")}
      href={href}
    >
      {children}
    </a>
  );
}

export function RightRail({ children }: { children: ReactNode }) {
  return (
    <aside className="flex w-full flex-col gap-4 xl:w-[360px]">
      {children}
    </aside>
  );
}

export function ProgressRing({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  const bounded = Math.max(0, Math.min(100, value));
  const background = `conic-gradient(var(--color-accent) ${bounded}%, var(--color-bg-muted) 0)`;

  return (
    <div
      aria-label={`${label}: ${bounded}%`}
      className="grid h-28 w-28 place-items-center rounded-full"
      role="img"
      style={{ background }}
    >
      <div className="grid h-20 w-20 place-items-center rounded-full bg-[var(--color-surface)] text-center">
        <div>
          <div className="text-xl font-semibold text-[var(--color-text)]">
            {bounded}%
          </div>
          <div className="text-[10px] text-[var(--color-text-muted)]">
            {label}
          </div>
        </div>
      </div>
    </div>
  );
}

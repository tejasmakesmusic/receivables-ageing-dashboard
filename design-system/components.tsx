"use client";

import Link from "next/link";
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  Check,
  ChevronDown,
  Circle,
  Loader2,
  Search,
  UploadCloud,
  X,
} from "lucide-react";
import { twMerge } from "tailwind-merge";

const cn = (...inputs: Array<string | false | null | undefined>) =>
  twMerge(clsx(inputs));

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg" | "icon";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-strong)]",
  secondary:
    "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]",
  ghost:
    "border-transparent bg-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
  destructive:
    "border-[var(--color-danger)] bg-[var(--color-danger)] text-white hover:brightness-95",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-[12px]",
  md: "h-9 px-3 text-[13px]",
  lg: "h-10 px-4 text-[14px]",
  icon: "h-9 w-9 px-0 text-[13px]",
};

export function DsButton({
  className,
  loading,
  size = "md",
  variant = "primary",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border font-medium transition-[background-color,border-color,color,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
}

export function DsLinkButton({
  children,
  className,
  href,
  variant = "secondary",
}: {
  children: ReactNode;
  className?: string;
  href: string;
  variant?: ButtonVariant;
}) {
  return (
    <Link
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-3 text-[13px] font-medium transition-[background-color,border-color,color,transform] active:scale-[0.98]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2",
        buttonVariants[variant],
        className,
      )}
      href={href}
    >
      {children}
    </Link>
  );
}

export function DsCard({
  actions,
  children,
  className,
  subtitle,
  title,
}: HTMLAttributes<HTMLDivElement> & {
  actions?: ReactNode;
  subtitle?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]",
        className,
      )}
    >
      {title || subtitle || actions ? (
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            {title ? (
              <h2 className="text-[18px] font-semibold leading-7 text-[var(--color-text)]">
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-muted)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </header>
      ) : null}
      <div className={title || subtitle || actions ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-[var(--color-status-neutral-bg)] text-[var(--color-status-neutral-text)]",
  success: "bg-[var(--color-status-current-bg)] text-[var(--color-status-current-text)]",
  warning: "bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)]",
  danger: "bg-[var(--color-status-danger-bg)] text-[var(--color-status-danger-text)]",
  info: "bg-[var(--color-status-info-bg)] text-[var(--color-status-info-text)]",
};

export function DsBadge({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: BadgeTone;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center gap-1.5 rounded-[var(--radius-pill)] px-2 text-[11px] font-semibold leading-4",
        badgeTones[tone],
        className,
      )}
    >
      <Circle aria-hidden="true" className="h-2 w-2 fill-current" />
      {children}
    </span>
  );
}

export function DsInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-[13px] text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:bg-[var(--color-bg-muted)] disabled:text-[var(--color-text-disabled)]",
        className,
      )}
      {...props}
    />
  );
}

export function DsTextarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[13px] leading-5 text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:bg-[var(--color-bg-muted)] disabled:text-[var(--color-text-disabled)]",
        className,
      )}
      {...props}
    />
  );
}

export function DsSelect({
  disabled,
  label,
  name,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="grid gap-2">
      <div className="text-[13px] font-medium text-[var(--color-text)]">{label}</div>
      <input name={name} type="hidden" value={value} />
      <div className="grid gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-1">
        <div className="flex h-8 items-center justify-between rounded-[var(--radius-xs)] bg-[var(--color-surface)] px-2 text-[13px] text-[var(--color-text)]">
          <span>{options.find((option) => option.value === value)?.label ?? "Select"}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 text-[var(--color-text-muted)]" />
        </div>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {options.map((option) => (
            <button
              aria-pressed={option.value === value}
              className={cn(
                "inline-flex h-8 items-center justify-center gap-1.5 rounded-[var(--radius-xs)] px-2 text-[12px] font-medium transition-colors",
                option.value === value
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
              )}
              disabled={disabled}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.value === value ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DsCombobox({
  label,
  name,
  onChange,
  options,
  placeholder = "Search",
  value,
}: {
  label: string;
  name: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  placeholder?: string;
  value: string;
}) {
  const [query, setQuery] = useState("");
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return options;
    return options.filter((option) =>
      `${option.label} ${option.value}`.toLowerCase().includes(normalized),
    );
  }, [options, query]);

  return (
    <div className="grid gap-2">
      <div className="text-[13px] font-medium text-[var(--color-text)]">{label}</div>
      <input name={name} type="hidden" value={value} />
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <label className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-subtle)]" />
          <DsInput
            className="pl-8"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={placeholder}
            value={query}
          />
        </label>
        <div className="mt-2 max-h-40 overflow-y-auto">
          {filteredOptions.map((option) => (
            <button
              className={cn(
                "flex h-8 w-full items-center justify-between rounded-[var(--radius-xs)] px-2 text-left text-[13px]",
                option.value === value
                  ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                  : "text-[var(--color-text)] hover:bg-[var(--color-bg-muted)]",
              )}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.label}
              {option.value === value ? <Check aria-hidden="true" className="h-4 w-4" /> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DsDatePicker({
  disabled,
  label,
  name,
  onChange,
  value,
}: {
  disabled?: boolean;
  label: string;
  name: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const today = new Date();
  const days = Array.from({ length: 14 }).map((_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - index);
    const iso = date.toISOString().slice(0, 10);
    return {
      label: index === 0 ? "Today" : iso.slice(5),
      value: iso,
    };
  });

  return (
    <div className="grid gap-2">
      <div className="text-[13px] font-medium text-[var(--color-text)]">{label}</div>
      <input name={name} type="hidden" value={value} />
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
        <DsInput
          disabled={disabled}
          inputMode="numeric"
          onChange={(event) => onChange(event.currentTarget.value)}
          pattern="\d{4}-\d{2}-\d{2}"
          placeholder="YYYY-MM-DD"
          value={value}
        />
        <div className="mt-2 grid grid-cols-4 gap-1">
          {days.slice(0, 8).map((day) => (
            <button
              aria-pressed={day.value === value}
              className={cn(
                "h-8 rounded-[var(--radius-xs)] text-[12px] font-medium",
                day.value === value
                  ? "bg-[var(--color-accent)] text-white"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
              )}
              disabled={disabled}
              key={day.value}
              onClick={() => onChange(day.value)}
              type="button"
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

type StatusTone = "neutral" | "success" | "warning" | "danger" | "info";

const statusToneByLabel: Record<string, StatusTone> = {
  Active: "success",
  Staged: "info",
  Published: "success",
  Matched: "success",
  Mismatched: "danger",
  Resolved: "success",
  Open: "info",
  Investigating: "warning",
  Escalated: "danger",
  Cancelled: "neutral",
  Blocked: "danger",
  "Read-only": "neutral",
  Pending: "warning",
};

export function DsStatusPill({ state }: { state: keyof typeof statusToneByLabel | string }) {
  return <DsBadge tone={statusToneByLabel[state] ?? "neutral"}>{state}</DsBadge>;
}

export function DsEmptyState({
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
      <svg aria-hidden="true" className="mb-4 h-16 w-24 text-[var(--color-accent)]" viewBox="0 0 96 64">
        <rect fill="currentColor" fillOpacity=".08" height="48" rx="8" width="72" x="12" y="8" />
        <path d="M28 24h40M28 34h26M28 44h16" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
      </svg>
      <h2 className="text-[16px] font-semibold leading-6 text-[var(--color-text)]">{title}</h2>
      <p className="mt-2 max-w-md text-[14px] leading-5 text-[var(--color-text-muted)]">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DsKpiCard({
  footnote,
  label,
  value,
}: {
  footnote?: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <DsCard className="p-5">
      <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-3 text-[24px] font-semibold leading-8 tabular-nums text-[var(--color-text)]">
        {value}
      </div>
      {footnote ? <div className="mt-2 text-[12px] leading-4 text-[var(--color-text-muted)]">{footnote}</div> : null}
    </DsCard>
  );
}

export function DsSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)]",
        className ?? "h-4 w-full",
      )}
    />
  );
}

export function DsFilterBar({
  chips,
  onClear,
  tabs,
}: {
  chips?: string[];
  onClear?: () => void;
  tabs: Array<{ active?: boolean; label: string; onClick?: () => void }>;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2">
      <div className="flex flex-wrap items-center gap-1">
        {tabs.map((tab) => (
          <button
            aria-pressed={tab.active}
            className={cn(
              "h-8 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium",
              tab.active
                ? "bg-[var(--color-accent)] text-white"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)] hover:text-[var(--color-text)]",
            )}
            key={tab.label}
            onClick={tab.onClick}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {chips?.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <DsBadge key={chip} tone="info">{chip}</DsBadge>
          ))}
          {onClear ? (
            <button
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12px] text-[var(--color-text-muted)] hover:bg-[var(--color-bg-muted)]"
              onClick={onClear}
              type="button"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type StepState = "done" | "current" | "blocked" | "not-started";

export function DsStepper({
  orientation = "horizontal",
  steps,
}: {
  orientation?: "horizontal" | "vertical";
  steps: Array<{ label: string; state: StepState }>;
}) {
  return (
    <ol
      className={cn(
        "gap-2",
        orientation === "horizontal" ? "grid md:grid-cols-[repeat(var(--step-count),minmax(0,1fr))]" : "grid",
      )}
      style={{ "--step-count": steps.length } as CSSProperties}
    >
      {steps.map((step, index) => {
        const tone: StatusTone =
          step.state === "done"
            ? "success"
            : step.state === "current"
              ? "info"
              : step.state === "blocked"
                ? "danger"
                : "neutral";
        return (
          <li
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            key={`${step.label}-${index}`}
          >
            <DsBadge tone={tone}>{index + 1}</DsBadge>
            <span className="text-[13px] font-medium text-[var(--color-text)]">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function DsContextPanel({
  children,
  title = "Context",
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <aside className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] xl:w-[360px]">
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-[18px] font-semibold leading-7 text-[var(--color-text)]">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </aside>
  );
}

export function DsDrawer({
  children,
  open,
  title,
}: {
  children: ReactNode;
  open: boolean;
  title: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/20">
      <div className="ml-auto h-full w-full max-w-[420px] border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-popover)]">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-[18px] font-semibold leading-7 text-[var(--color-text)]">{title}</h2>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function DsTooltip({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span className="pointer-events-none absolute left-1/2 top-full z-50 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-[var(--radius-sm)] bg-[var(--color-text)] px-2 py-1 text-[12px] text-[var(--color-bg)] shadow-[var(--shadow-popover)] group-hover:block group-focus-within:block">
        {label}
      </span>
    </span>
  );
}

export function DsToastViewport() {
  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 grid max-w-sm gap-2"
      role="status"
    />
  );
}

export function DsDataTable({
  children,
  className,
  empty,
  error,
  loading,
  pagination,
}: {
  children: ReactNode;
  className?: string;
  empty?: ReactNode;
  error?: ReactNode;
  loading?: boolean;
  pagination?: ReactNode;
}) {
  if (loading) {
    return (
      <div className={cn("rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3", className)}>
        <div className="grid gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <DsSkeleton className="h-9" key={index} />
          ))}
        </div>
      </div>
    );
  }

  if (error) return <>{error}</>;
  if (empty) return <>{empty}</>;

  return (
    <div className={cn("overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]", className)}>
      <div className="overflow-x-auto">{children}</div>
      {pagination ? <div className="border-t border-[var(--color-border)] p-3">{pagination}</div> : null}
    </div>
  );
}

export function DsFileDropzone({
  disabled,
  file,
  onFile,
}: {
  disabled?: boolean;
  file: File | null;
  onFile: (file: File) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-subtle)] p-5 transition-colors",
        disabled ? "opacity-60" : "hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]",
      )}
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const nextFile = event.dataTransfer.files.item(0);
        if (nextFile && !disabled) onFile(nextFile);
      }}
      role="region"
    >
      <div className="flex flex-col items-center justify-center gap-3 text-center">
        <div className="grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--color-surface)] text-[var(--color-accent)]">
          <UploadCloud aria-hidden="true" className="h-5 w-5" />
        </div>
        <div>
          <div className="text-[14px] font-semibold text-[var(--color-text)]">
            Drop workbook here
          </div>
          <p className="mt-1 text-[13px] text-[var(--color-text-muted)]">
            XLSX or XLS. Parser detects Tally, Xero, or Credit Period config.
          </p>
        </div>
        {file ? (
          <div className="rounded-[var(--radius-sm)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-text)]">
            {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
          </div>
        ) : (
          <div className="text-[12px] text-[var(--color-text-muted)]">
            File picker is disabled in UI V2 to avoid native file controls; drag and drop is supported.
          </div>
        )}
      </div>
    </div>
  );
}

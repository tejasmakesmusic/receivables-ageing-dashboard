import Link from "next/link";

export type ProgressStep = {
  id: "upload" | "parse" | "review" | "resolve" | "publish" | "reconcile";
  label: string;
  description: string;
  state: "not_started" | "active" | "blocked" | "completed";
  blocker?: string;
  href?: string;
};

export type ProgressPathProps = {
  steps: ProgressStep[];
};

const circleClasses: Record<ProgressStep["state"], string> = {
  completed:
    "border-[var(--color-success)] bg-[var(--color-success)] text-white",
  active: "border-[var(--color-accent)] bg-[var(--color-accent)] text-white",
  blocked: "border-[var(--color-danger)] bg-[var(--color-danger)] text-white",
  not_started:
    "border-[var(--color-border-strong)] bg-[var(--color-bg-muted)] text-[var(--color-text-muted)]",
};

const connectorClasses: Record<ProgressStep["state"], string> = {
  completed: "bg-[var(--color-success)]",
  active: "bg-[var(--color-accent)]",
  blocked: "bg-[var(--color-danger)]",
  not_started: "bg-[var(--color-border-strong)]",
};

export function ProgressPath({ steps }: ProgressPathProps) {
  return (
    <ol aria-label="Progress" className="grid gap-[var(--spacing-4)] lg:grid-cols-6">
      {steps.map((step, index) => (
        <li
          aria-current={step.state === "active" ? "step" : undefined}
          className="relative flex gap-[var(--spacing-3)] lg:block"
          key={step.id}
        >
          {index < steps.length - 1 ? (
            <span
              aria-hidden="true"
              className={[
                "absolute left-[15px] top-8 h-[calc(100%-20px)] w-px lg:left-[calc(50%+20px)] lg:right-[calc(-50%+20px)] lg:top-[15px] lg:h-px lg:w-auto",
                connectorClasses[step.state],
              ].join(" ")}
            />
          ) : null}
          <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-pill)] border text-xs font-semibold">
            <span className={circleClasses[step.state]} />
            <span
              className={[
                "absolute inset-0 flex items-center justify-center rounded-[var(--radius-pill)] border",
                circleClasses[step.state],
              ].join(" ")}
            >
              {index + 1}
            </span>
          </div>
          <div className="min-w-0 pb-[var(--spacing-4)] lg:mt-[var(--spacing-3)] lg:pb-0">
            <div className="flex flex-wrap items-center gap-[var(--spacing-2)]">
              <p className="text-sm font-medium text-[var(--color-text)]">
                {step.label}
              </p>
              {step.href ? (
                <Link
                  aria-label={`Open ${step.label}`}
                  className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                  href={step.href}
                >
                  Open {"->"}
                </Link>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {step.description}
            </p>
            {step.state === "blocked" && step.blocker ? (
              <p className="mt-1 text-xs font-medium text-[var(--color-danger)]">
                {step.blocker}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

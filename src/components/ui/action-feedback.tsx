import { StatusTag } from "@/components/ui/status-tag";
import type { ActionFeedbackModel } from "@/components/ui/action-feedback-copy";

interface ActionFeedbackProps {
  feedback: ActionFeedbackModel;
}

export function ActionFeedback({ feedback }: ActionFeedbackProps) {
  return (
    <div
      aria-live="polite"
      className="rounded-[var(--radius-md)] border border-[var(--color-status-current-border)] bg-[var(--color-status-current-bg)] p-[var(--spacing-3)] text-xs"
      role="status"
    >
      <div className="flex items-start justify-between gap-[var(--spacing-2)]">
        <div>
          <p className="font-medium text-[var(--color-status-current-text)]">
            {feedback.title}
          </p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            {feedback.message}
          </p>
        </div>
        <StatusTag status={feedback.status} />
      </div>

      <dl className="mt-[var(--spacing-2)] grid grid-cols-2 gap-x-[var(--spacing-2)] gap-y-1">
        {feedback.facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-[var(--color-text-subtle)]">{fact.label}</dt>
            <dd className="break-words font-medium text-[var(--color-text)]">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

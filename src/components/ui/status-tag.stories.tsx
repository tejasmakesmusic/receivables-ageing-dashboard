import { StatusTag } from "@/components/ui/status-tag";

const financeStates = [
  "NOT_DUE",
  "0_30",
  "31_60",
  "61_90",
  "90_PLUS",
  "SETTLED",
  "PTP_OPEN",
  "PTP_BROKEN",
  "DISPUTE_OPEN",
  "MATCHED",
  "MISMATCH",
  "OVERRIDE",
] as const;

const meta = {
  title: "States/StatusTag",
  component: StatusTag,
};

export default meta;

export function AllFinanceSemanticColors() {
  return (
    <div className="grid max-w-3xl gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {financeStates.map((status) => (
        <div
          className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
          key={status}
        >
          <span className="text-xs font-medium text-[var(--color-text-muted)]">
            {status}
          </span>
          <StatusTag aria-label={`Finance status ${status}`} status={status} />
        </div>
      ))}
    </div>
  );
}

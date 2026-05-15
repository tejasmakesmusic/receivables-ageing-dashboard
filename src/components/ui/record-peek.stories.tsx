import { RecordPeek } from "@/components/ui/record-peek";
import { StatusTag } from "@/components/ui/status-tag";

const meta = {
  title: "Overlays/RecordPeek",
  component: RecordPeek,
};

export default meta;

export function Default() {
  return (
    <div className="relative h-[640px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)]">
      <RecordPeek
        closeHref="#"
        expandHref="#"
        meta="Updated 2 hours ago"
        open
        status={<StatusTag status="90_PLUS" />}
        subtitle="Acme Corp"
        title="INV-2401"
      >
        <div className="space-y-4 text-[13px]">
          <div className="text-[24px] font-semibold text-[var(--color-text)]">
            INR 4,52,000
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            Due date: 12 Nov 2026
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            Next action: log collection follow-up
          </div>
        </div>
      </RecordPeek>
    </div>
  );
}

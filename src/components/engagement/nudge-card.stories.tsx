import { NudgeCard } from "@/components/engagement/nudge-card";

const onSnooze = () => undefined;

const meta = {
  title: "Engagement/NudgeCard",
  component: NudgeCard,
};

export default meta;

export function PTPDue() {
  return (
    <NudgeCard
      count={5}
      description="Review promises due today and mark kept, broken, or cancelled."
      href="/promises-to-pay?status=OPEN"
      id="ptp-due"
      kind="ptp_due"
      onSnooze={onSnooze}
      title="Promises due today"
    />
  );
}

export function StaleFollowup() {
  return (
    <NudgeCard
      count={8}
      description="Tasks without a recent follow-up need an owner update."
      href="/tasks?reason=STALE_FOLLOWUP"
      id="stale-followup"
      kind="stale_followup"
      onSnooze={onSnooze}
      title="Stale follow-ups"
    />
  );
}

export function DigestPending() {
  return (
    <NudgeCard
      description="The CFO digest is queued for admin review before sending."
      href="/admin/digest"
      id="digest-pending"
      kind="digest_pending"
      onSnooze={onSnooze}
      title="Digest pending approval"
    />
  );
}

export function ReconciliationUnmatched() {
  return (
    <NudgeCard
      count={2}
      description="Snapshot balances differ from accepted accounting AR."
      href="/reconciliation?status=MISMATCH"
      id="reconciliation-unmatched"
      kind="reconciliation_unmatched"
      onSnooze={onSnooze}
      title="Reconciliation mismatches"
    />
  );
}

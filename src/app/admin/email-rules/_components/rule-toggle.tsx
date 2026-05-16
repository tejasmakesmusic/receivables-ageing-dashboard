"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/ui/toast";

export function RuleToggle({
  ruleId,
  ruleType,
  isActive,
}: {
  ruleId: string;
  ruleType: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !isActive;
    const verb = next ? "activate" : "deactivate";
    const warning = next
      ? `Activate ${ruleType}? This will start sending emails on the configured schedule.`
      : `Deactivate ${ruleType}? Scheduled emails will stop until re-enabled.`;
    if (!confirm(warning)) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/email-rules/${ruleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: next }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(payload?.error ?? `Failed to ${verb} (${res.status})`);
      }
      toast.success(`${ruleType} ${next ? "activated" : "deactivated"}.`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Failed to ${verb}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      aria-pressed={isActive}
      className={
        "inline-flex h-7 items-center rounded-[var(--radius-sm)] border px-2.5 text-xs font-medium transition disabled:opacity-50 " +
        (isActive
          ? "border-[var(--color-status-warning-border)] bg-[var(--color-status-warning-bg)] text-[var(--color-status-warning-text)] hover:opacity-80"
          : "border-[var(--color-accent)] bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-strong)]")
      }
      disabled={busy}
      onClick={toggle}
      type="button"
    >
      {busy ? "Saving…" : isActive ? "Deactivate" : "Activate"}
    </button>
  );
}

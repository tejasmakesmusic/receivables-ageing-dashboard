import { Button } from "@/components/ui/button";
import { SidePanel, SidePanelField } from "@/components/ui/side-panel";
import { StatusTag } from "@/components/ui/status-tag";

function Fields() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <SidePanelField label="Outstanding">INR 12,40,000</SidePanelField>
      <SidePanelField label="Ageing bucket">
        <StatusTag status="90_PLUS" />
      </SidePanelField>
      <SidePanelField label="Owner">Priya Sharma</SidePanelField>
      <SidePanelField label="Entity">IND</SidePanelField>
    </div>
  );
}

const meta = {
  title: "Panels/SidePanel",
  component: SidePanel,
};

export default meta;

export function Default() {
  return (
    <SidePanel
      className="max-w-xl"
      subtitle="ABC Manufacturing Pvt Ltd"
      title="INV-2026-041"
    >
      <Fields />
    </SidePanel>
  );
}

export function WithStatus() {
  return (
    <SidePanel
      className="max-w-xl"
      status={<StatusTag status="PTP_OPEN" />}
      subtitle="Promise due on 12 May 2026"
      title="ABC Manufacturing Pvt Ltd"
    >
      <Fields />
    </SidePanel>
  );
}

export function WithNextAction() {
  return (
    <SidePanel
      className="max-w-xl"
      nextAction={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-[var(--color-text-muted)]">
            Safest next action: log today&apos;s follow-up.
          </span>
          <Button size="sm">Log follow-up</Button>
        </div>
      }
      subtitle="Next action due today"
      title="Collection task"
    >
      <Fields />
    </SidePanel>
  );
}

export function WithFullPageLink() {
  return (
    <SidePanel
      className="max-w-xl"
      openFullPageHref="/invoices/inv-001"
      openFullPageLabel="Open invoice"
      subtitle="ABC Manufacturing Pvt Ltd"
      title="INV-2026-041"
    >
      <Fields />
    </SidePanel>
  );
}

export function WithAuditMeta() {
  return (
    <SidePanel
      className="max-w-xl"
      meta="Updated by Amit on 7 May 2026 · Audit event AUD-1042"
      status={<StatusTag status="OVERRIDE" />}
      subtitle="Published with admin override"
      title="Snapshot reconciliation"
    >
      <Fields />
    </SidePanel>
  );
}

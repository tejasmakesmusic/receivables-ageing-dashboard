import { DataTable } from "@/components/ui/data-table";
import {
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";

export default function TasksLoading() {
  return (
    <PageFrame>
      <PageHeader title="Tasks">Loading task queue...</PageHeader>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelHeader title="Queue">
            Dense task list for scanning and review.
          </PanelHeader>
          <DataTable
            columns={[
              { key: "task", header: "Task", cell: () => null, sticky: "left" },
              { key: "party", header: "Party", cell: () => null, sticky: "left" },
              { key: "ageing_signal", header: "Ageing / Signal", cell: () => null },
              { key: "priority", header: "Priority", cell: () => null, align: "right" },
              { key: "owner", header: "Assigned User", cell: () => null },
              { key: "status", header: "Status", cell: () => null },
              { key: "reason_code", header: "Reason Code", cell: () => null },
              { key: "due", header: "Snooze / Due", cell: () => null },
              { key: "created", header: "Created", cell: () => null },
            ]}
            loadingRowCount={6}
            minWidthClass="min-w-[1080px]"
            rowKey={() => "loading"}
            rows={[]}
            state="loading"
          />
        </Panel>
        <RightRail>
          <Panel className="h-48 animate-pulse" />
        </RightRail>
      </div>
    </PageFrame>
  );
}

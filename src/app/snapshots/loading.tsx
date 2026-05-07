import { DataTable } from "@/components/ui/data-table";
import {
  PageFrame,
  PageHeader,
  Panel,
  RightRail,
} from "@/components/ui/workspace";

export default function SnapshotsLoading() {
  return (
    <PageFrame>
      <PageHeader title="Snapshots">Loading snapshots...</PageHeader>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <DataTable
            columns={[
              { key: "snapshot", header: "Snapshot", cell: () => null, sticky: "left" },
              { key: "entity", header: "Entity", cell: () => null, sticky: "left" },
              { key: "source", header: "Source", cell: () => null },
              { key: "status", header: "Status", cell: () => null },
              { key: "uploaded_by", header: "Uploaded By", cell: () => null },
              { key: "uploaded_at", header: "Uploaded", cell: () => null },
              { key: "rows", header: "Rows", cell: () => null, align: "right" },
              { key: "warnings", header: "Warnings", cell: () => null, align: "right" },
              { key: "outstanding", header: "Outstanding", cell: () => null, align: "right" },
            ]}
            loadingRowCount={6}
            minWidthClass="min-w-[1240px]"
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

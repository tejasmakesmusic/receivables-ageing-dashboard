import { DataTable } from "@/components/ui/data-table";
import {
  PageFrame,
  PageHeader,
  Panel,
  RightRail,
} from "@/components/ui/workspace";

export default function DisputesLoading() {
  return (
    <PageFrame>
      <PageHeader title="Dispute Cases">Loading dispute cases...</PageHeader>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <DataTable
            columns={[
              { key: "invoice", header: "Invoice", cell: () => null, sticky: "left" },
              { key: "party", header: "Party", cell: () => null, sticky: "left" },
              { key: "reason", header: "Reason Code", cell: () => null },
              { key: "status", header: "Dispute Status", cell: () => null },
              { key: "expected", header: "Expected Resolution", cell: () => null },
              { key: "owner", header: "Owner", cell: () => null },
              { key: "created", header: "Created", cell: () => null },
            ]}
            loadingRowCount={6}
            minWidthClass="min-w-[1180px]"
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

import { DataTable } from "@/components/ui/data-table";
import {
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";

export default function InvoicesLoading() {
  return (
    <PageFrame>
      <PageHeader title="Invoice Ageing Workbench">
        Loading invoices…
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title="Invoice Review Queue" />
            <DataTable
              columns={[
                { key: "ref", header: "Invoice", cell: () => null, sticky: "left" },
                { key: "account", header: "Account", cell: () => null, sticky: "left" },
                { key: "issue", header: "Issue Date", cell: () => null },
                { key: "due", header: "Due Date", cell: () => null },
                { key: "age", header: "Age", cell: () => null, align: "right" },
                { key: "bucket", header: "Bucket", cell: () => null },
                { key: "amount", header: "Outstanding", cell: () => null, align: "right" },
                { key: "status", header: "Status", cell: () => null },
              ]}
              rowKey={() => "loading"}
              rows={[]}
              state="loading"
              loadingRowCount={8}
            />
          </Panel>
        </div>
        <RightRail>
          <Panel className="h-48 animate-pulse" />
        </RightRail>
      </div>
    </PageFrame>
  );
}

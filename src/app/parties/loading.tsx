import { DataTable } from "@/components/ui/data-table";
import {
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";

export default function PartiesLoading() {
  return (
    <PageFrame>
      <PageHeader title="Parties">Loading parties...</PageHeader>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title="Party Register" />
            <DataTable
              columns={[
                {
                  cell: () => null,
                  header: "Canonical Name",
                  key: "canonical_name",
                  sticky: "left",
                },
                {
                  cell: () => null,
                  header: "Entity",
                  key: "entity_code",
                  sticky: "left",
                },
                {
                  align: "right",
                  cell: () => null,
                  header: "Total Open Exposure",
                  key: "total_open_exposure",
                },
                {
                  align: "right",
                  cell: () => null,
                  header: "90+ Exposure",
                  key: "ninety_plus_exposure",
                },
                {
                  align: "right",
                  cell: () => null,
                  header: "Open Invoices",
                  key: "open_invoice_count",
                },
                {
                  align: "right",
                  cell: () => null,
                  header: "Open Tasks",
                  key: "open_task_count",
                },
                { cell: () => null, header: "Status", key: "status" },
              ]}
              loadingRowCount={8}
              minWidthClass="min-w-[1060px]"
              rowKey={() => "loading"}
              rows={[]}
              state="loading"
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

import { DataTable } from "@/components/ui/data-table";
import {
  PageFrame,
  PageHeader,
  Panel,
  PanelHeader,
  RightRail,
} from "@/components/ui/workspace";

export default function PromisesLoading() {
  return (
    <PageFrame>
      <PageHeader title="Promises to Pay">Loading promises...</PageHeader>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Panel>
            <PanelHeader title="Promise Register" />
            <DataTable
              columns={[
                {
                  cell: () => null,
                  header: "Invoice",
                  key: "invoice_ref",
                  sticky: "left",
                },
                {
                  cell: () => null,
                  header: "Party",
                  key: "party_name",
                  sticky: "left",
                },
                {
                  align: "right",
                  cell: () => null,
                  header: "Promised Amount",
                  key: "amount",
                },
                {
                  cell: () => null,
                  header: "Promised Date",
                  key: "promised_date",
                },
                { cell: () => null, header: "Status", key: "status" },
                { cell: () => null, header: "Kept/Broken", key: "outcome" },
                {
                  cell: () => null,
                  header: "Contact Person",
                  key: "contact_person",
                },
              ]}
              loadingRowCount={8}
              minWidthClass="min-w-[1120px]"
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

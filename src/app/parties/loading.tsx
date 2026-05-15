import { DataTable } from "@/components/ui/data-table";

type Row = Record<string, unknown>;

const COLUMNS = [
  { key: "canonical_name", header: "Canonical Name",     sticky: "left" as const, cell: () => null },
  { key: "entity",         header: "Entity",             sticky: "left" as const, cell: () => null },
  { key: "exposure",       header: "Total Open Exposure", cell: () => null },
  { key: "exposure_90",    header: "90+ Exposure",       cell: () => null },
  { key: "open_invoices",  header: "Open Invoices",      cell: () => null },
  { key: "status",         header: "Status",             cell: () => null },
];

export default function Loading() {
  return (
    <DataTable<Row>
      columns={COLUMNS}
      rows={[]}
      rowKey={() => ""}
      state="loading"
    />
  );
}

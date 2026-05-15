import { DataTable } from "@/components/ui/data-table";

type Row = Record<string, unknown>;

const COLUMNS = [
  { key: "invoice_number", header: "Invoice", sticky: "left" as const, cell: () => null },
  { key: "party_name",     header: "Account", sticky: "left" as const, cell: () => null },
  { key: "issue_date",     header: "Issue",   cell: () => null },
  { key: "due_date",       header: "Due",     cell: () => null },
  { key: "bucket",         header: "Bucket",  cell: () => null },
  { key: "outstanding",    header: "Outstanding", cell: () => null },
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

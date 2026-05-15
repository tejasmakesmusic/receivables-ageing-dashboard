import { DataTable } from "@/components/ui/data-table";

type Row = Record<string, unknown>;

const COLUMNS = [
  { key: "invoice_number",  header: "Invoice", sticky: "left" as const, cell: () => null },
  { key: "party_name",      header: "Party",   sticky: "left" as const, cell: () => null },
  { key: "promised_amount", header: "Promised Amount", cell: () => null },
  { key: "promised_date",   header: "Promised Date",   cell: () => null },
  { key: "status",          header: "Status",          cell: () => null },
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

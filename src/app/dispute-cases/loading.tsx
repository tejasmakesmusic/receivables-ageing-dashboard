import { DataTable } from "@/components/ui/data-table";

type Row = Record<string, unknown>;

const COLUMNS = [
  { key: "invoice_number", header: "Invoice", sticky: "left" as const, cell: () => null },
  { key: "party_name",     header: "Party",   sticky: "left" as const, cell: () => null },
  { key: "reason_code",    header: "Reason Code",        cell: () => null },
  { key: "dispute_status", header: "Dispute Status",     cell: () => null },
  { key: "expected_resolution", header: "Expected Resolution", cell: () => null },
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

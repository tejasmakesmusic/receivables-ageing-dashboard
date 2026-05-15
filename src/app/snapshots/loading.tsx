import { DataTable } from "@/components/ui/data-table";

type Row = Record<string, unknown>;

const COLUMNS = [
  { key: "name",       header: "Snapshot", sticky: "left" as const, cell: () => null },
  { key: "entity",     header: "Entity",   sticky: "left" as const, cell: () => null },
  { key: "source",     header: "Source",   cell: () => null },
  { key: "status",     header: "Status",   cell: () => null },
  { key: "uploaded_at",header: "Uploaded", cell: () => null },
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

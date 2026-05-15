import { DataTable } from "@/components/ui/data-table";

type Row = Record<string, unknown>;

const COLUMNS = [
  { key: "task",       header: "Task",   sticky: "left" as const, cell: () => null },
  { key: "party",      header: "Party",  sticky: "left" as const, cell: () => null },
  { key: "priority",   header: "Priority",  cell: () => null },
  { key: "status",     header: "Status",    cell: () => null },
  { key: "due_date",   header: "Snooze / Due", cell: () => null },
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

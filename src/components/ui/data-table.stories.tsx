import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn, type DataTableSort } from "@/components/ui/data-table";
import { StatusTag } from "@/components/ui/status-tag";

type InvoiceRow = {
  id: string;
  invoice: string;
  party: string;
  entity: "IND" | "UAE";
  bucket: string;
  amount: string;
  owner: string;
  nextAction: string;
};

const rows: InvoiceRow[] = [
  { id: "inv-001", invoice: "INV-2026-041", party: "ABC Manufacturing Pvt Ltd", entity: "IND", bucket: "90_PLUS", amount: "INR 12,40,000", owner: "Priya", nextAction: "Call finance controller today" },
  { id: "inv-002", invoice: "DXB-7821", party: "Gulf Retail LLC", entity: "UAE", bucket: "31_60", amount: "AED 82,500", owner: "Amit", nextAction: "Review dispute evidence" },
  { id: "inv-003", invoice: "INV-2026-057", party: "Northstar Services", entity: "IND", bucket: "NOT_DUE", amount: "INR 4,18,000", owner: "Priya", nextAction: "No action before due date" },
];

const columns: DataTableColumn<InvoiceRow>[] = [
  { key: "invoice", header: "Invoice", cell: (row) => row.invoice, sortKey: "invoice", sticky: "left", width: "w-[160px]" },
  { key: "party", header: "Party", cell: (row) => row.party, sortKey: "party", width: "w-[240px]" },
  { key: "entity", header: "Entity", cell: (row) => row.entity },
  { key: "bucket", header: "Ageing", cell: (row) => <StatusTag status={row.bucket} /> },
  { key: "amount", header: "Amount", cell: (row) => row.amount, align: "right", sortKey: "amount" },
  { key: "owner", header: "Owner", cell: (row) => row.owner },
  { key: "nextAction", header: "Next action", cell: (row) => row.nextAction, width: "w-[260px]" },
];

const baseProps = {
  columns,
  rowHref: (row: InvoiceRow) => `/invoices/${row.id}`,
  rowKey: (row: InvoiceRow) => row.id,
};

const sortHref = (sort: DataTableSort) =>
  `#sort=${sort.key}:${sort.direction}`;

const meta = {
  title: "Tables/DataTable",
  component: DataTable,
};

export default meta;

export function Default() {
  return <DataTable {...baseProps} rows={rows} />;
}

export function Loading() {
  return <DataTable {...baseProps} loadingRowCount={4} rows={[]} state="loading" />;
}

export function Empty() {
  return (
    <DataTable
      {...baseProps}
      emptyState={{
        title: "No invoices yet",
        description: "Upload an AR snapshot to populate the invoice table.",
        action: <Button size="sm">Upload snapshot</Button>,
      }}
      rows={[]}
    />
  );
}

export function FilteredEmpty() {
  return (
    <DataTable
      {...baseProps}
      filteredEmptyState={{
        title: "No broken promises",
        description: "View open promises or clear filters to broaden the list.",
        action: <Button size="sm" variant="secondary">View open promises</Button>,
      }}
      isFiltered
      rows={[]}
    />
  );
}

export function Error() {
  return (
    <DataTable
      {...baseProps}
      errorState={{
        title: "Invoices could not be loaded",
        description: "Refresh the view or reopen the saved view.",
      }}
      rows={[]}
      state="error"
    />
  );
}

export function WithSelection() {
  return (
    <DataTable
      {...baseProps}
      bulkActions={
        <>
          <Button size="sm">Assign owner</Button>
          <Button size="sm" variant="secondary">Snooze</Button>
        </>
      }
      rows={rows}
      selectable
      selectedRowKey="inv-002"
      selectedRowKeys={["inv-002"]}
    />
  );
}

export function Sortable() {
  return (
    <DataTable
      {...baseProps}
      rows={rows}
      sort={{ key: "amount", direction: "desc" }}
      sortHref={sortHref}
    />
  );
}

export function WithFrozenColumns() {
  return (
    <DataTable
      {...baseProps}
      minWidthClass="min-w-[1180px]"
      rows={rows}
      sortHref={sortHref}
    />
  );
}

export function CompactDensity() {
  return <DataTable {...baseProps} density="compact" rows={rows} />;
}

export function WithFilterBar() {
  return (
    <DataTable
      {...baseProps}
      filterBar={
        <>
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] px-2 py-1 text-[12px] text-[var(--color-text)]">
            Status: Overdue
          </span>
          <span className="rounded-[var(--radius-sm)] bg-[var(--color-bg-muted)] px-2 py-1 text-[12px] text-[var(--color-text)]">
            Owner: Priya
          </span>
        </>
      }
      rows={rows}
      toolbar={<Button size="sm" variant="secondary">Density</Button>}
    />
  );
}

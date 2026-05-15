"use client";

import {
  DsBadge,
  DsButton,
  DsCard,
  DsDataTable,
  DsEmptyState,
  DsFileDropzone,
  DsInput,
  DsKpiCard,
  DsLinkButton,
  DsSelect,
} from "../../../design-system/components";

export default function DesignSystemPage() {
  return (
    <main className="min-h-screen bg-[var(--color-bg)] p-6 text-[var(--color-text)]">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="border-b border-[var(--color-border)] pb-4">
          <DsBadge tone="info">UI V2</DsBadge>
          <h1 className="mt-3 text-[24px] font-semibold leading-8">
            Receivables OS design system
          </h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-5 text-[var(--color-text-muted)]">
            Token-backed primitives for decision-first AR workflows.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <DsKpiCard label="Outstanding" value="₹4.2 Cr" footnote="Snapshot 15 May 2026" />
          <DsKpiCard label="Overdue" value="₹86.4 L" footnote="18.4% of AR" />
          <DsKpiCard label="Blocked" value="12" footnote="Disputes and staging blockers" />
          <DsKpiCard label="Today" value="7" footnote="Actions remaining" />
        </section>

        <DsCard
          actions={
            <div className="flex gap-2">
              <DsButton type="button">Primary</DsButton>
              <DsButton type="button" variant="secondary">Secondary</DsButton>
              <DsButton type="button" variant="ghost">Ghost</DsButton>
            </div>
          }
          subtitle="Shared card, button, badge, input, select, table, empty, and upload primitives."
          title="Primitive set"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <DsBadge tone="success">Paid</DsBadge>
                <DsBadge tone="warning">Due soon</DsBadge>
                <DsBadge tone="danger">Overdue</DsBadge>
                <DsBadge tone="info">In review</DsBadge>
              </div>
              <DsInput placeholder="Search invoices, parties, tasks..." />
              <DsSelect
                label="Entity"
                name="entity_demo"
                onChange={() => undefined}
                options={[
                  { label: "India · Tally", value: "IND" },
                  { label: "UAE · Xero", value: "UAE" },
                ]}
                value="IND"
              />
              <DsFileDropzone file={null} onFile={() => undefined} />
            </div>
            <DsEmptyState
              action={<DsLinkButton href="/upload" variant="primary">Upload snapshot</DsLinkButton>}
              description="When a workbook is uploaded, staging blockers and parser warnings appear before publish."
              title="No staged snapshot yet"
            />
          </div>
        </DsCard>

        <DsCard title="Dense table pattern" subtitle="Sticky header-ready, compact row rhythm, semantic badges, mono amounts.">
          <DsDataTable>
            <table className="w-full min-w-[760px] text-[13px]">
              <thead className="bg-[var(--color-bg-subtle)] text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
                <tr>
                  <th className="px-3 py-2" scope="col">Invoice</th>
                  <th className="px-3 py-2" scope="col">Customer</th>
                  <th className="px-3 py-2 text-right" scope="col">Amount</th>
                  <th className="px-3 py-2" scope="col">Status</th>
                  <th className="px-3 py-2" scope="col">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {[
                  ["INV-2401", "Acme Corp", "₹4,52,000.00", "Overdue", "Send reminder"],
                  ["INV-2402", "Northstar", "₹1,78,500.00", "In review", "Review dispute"],
                  ["INV-2403", "Kite Labs", "₹82,000.00", "Paid", "View audit trail"],
                ].map((row) => (
                  <tr className="h-10 hover:bg-[var(--color-bg-subtle)]" key={row[0]}>
                    <td className="px-3 py-2 font-medium text-[var(--color-accent)]">{row[0]}</td>
                    <td className="px-3 py-2">{row[1]}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{row[2]}</td>
                    <td className="px-3 py-2">
                      <DsBadge tone={row[3] === "Paid" ? "success" : row[3] === "Overdue" ? "danger" : "warning"}>
                        {row[3]}
                      </DsBadge>
                    </td>
                    <td className="px-3 py-2">{row[4]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DsDataTable>
        </DsCard>
      </div>
    </main>
  );
}

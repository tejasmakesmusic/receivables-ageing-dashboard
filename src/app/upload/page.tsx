import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  DsBadge,
  DsCard,
  DsLinkButton,
  DsStatusPill,
  DsStepper,
} from "../../../design-system/components";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { UploadSnapshotForm } from "./_components/upload-snapshot-form";
import { XeroPullCard } from "./_components/xero-pull-card";

export default async function UploadPage() {
  await requirePageRole("/upload", role_enum.ANALYST, role_enum.ADMIN);
  const uiV2 = process.env.NEXT_PUBLIC_UI_V2 === "true";

  if (uiV2) {
    return (
      <main className="min-h-screen bg-[var(--color-bg)] p-4 text-[var(--color-text)] sm:p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--color-border)] pb-4">
              <div>
                <DsLinkButton href="/snapshots" variant="ghost">
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  Snapshots
                </DsLinkButton>
                <h1 className="mt-3 text-[24px] font-semibold leading-8 tracking-[-0.01em]">
                  Upload Snapshot
                </h1>
                <p className="mt-1 max-w-2xl text-[14px] leading-5 text-[var(--color-text-muted)]">
                  Start a controlled AR snapshot. The parser stages every row for review before publish.
                </p>
              </div>
              <DsBadge tone="info">Stage before publish</DsBadge>
            </div>

            <DsCard
              subtitle="One-click read-only pull from the UAE Xero organisation. Receivables OS still owns ageing, credit days, staging, and publish."
              title="Pull from Xero (UAE)"
            >
              <XeroPullCard />
            </DsCard>

            <div className="flex items-center gap-3 text-[12px] uppercase tracking-wide text-[var(--color-text-muted)]">
              <span className="h-px flex-1 bg-[var(--color-border)]" />
              <span>or upload a workbook</span>
              <span className="h-px flex-1 bg-[var(--color-border)]" />
            </div>

            <DsCard
              subtitle="For Tally exports (IND) or Xero workbook exports (UAE). The parser stages every row for review before publish."
              title="Upload Excel/CSV workbook"
            >
              <div className="mb-5">
                <DsStepper
                  steps={[
                    { label: "Upload", state: "current" },
                    { label: "Stage validation", state: "not-started" },
                    { label: "Publish", state: "not-started" },
                  ]}
                />
              </div>
              <UploadSnapshotForm />
            </DsCard>
          </div>

          <aside className="space-y-4">
            <DsCard
              subtitle="This upload keeps source evidence and blocks publish if parser errors remain."
              title="Next decision"
            >
              <div className="rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] p-4 text-[13px] leading-5 text-[var(--color-text)]">
                Resolve staging blockers after upload, then publish only when aliases, credit terms, and parse errors are clean.
              </div>
            </DsCard>
            <DsCard title="Controls">
              <div className="mb-4 flex flex-wrap gap-2">
                <DsStatusPill state="Staged" />
                <DsStatusPill state="Blocked" />
                <DsStatusPill state="Published" />
              </div>
              <ul className="space-y-3 text-[13px] leading-5 text-[var(--color-text-muted)]">
                <li className="flex gap-2">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
                  CFO and pending users cannot mutate snapshots.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
                  Ageing uses the snapshot as-of date, never wall-clock today.
                </li>
                <li className="flex gap-2">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-success)]" />
                  Parser errors are staged for analyst review.
                </li>
              </ul>
            </DsCard>
          </aside>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="space-y-2">
          <Link
            href="/snapshots"
            className="text-sm text-[var(--color-accent)] hover:underline"
          >
            {"<- Snapshots"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Upload Snapshot
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pull from Xero (UAE)</CardTitle>
          </CardHeader>
          <CardContent>
            <XeroPullCard />
          </CardContent>
        </Card>

        <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          <span className="h-px flex-1 bg-[var(--color-border)]" />
          <span>or upload a workbook</span>
          <span className="h-px flex-1 bg-[var(--color-border)]" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Upload Excel/CSV workbook</CardTitle>
          </CardHeader>
          <CardContent>
            <UploadSnapshotForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

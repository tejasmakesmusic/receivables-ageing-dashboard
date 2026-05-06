import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";

export default async function UploadPage() {
  await requirePageRole("/upload", role_enum.ANALYST, role_enum.ADMIN);

  return (
    <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <div className="space-y-2">
          <Link
            href="/snapshots"
            className="text-sm text-blue-700 hover:underline"
          >
            {"<- Snapshots"}
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            Upload Snapshot
          </h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Workbook</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              action="/api/snapshots"
              className="grid gap-4 text-sm"
              encType="multipart/form-data"
              method="post"
            >
              <label className="grid gap-1">
                <span className="font-medium">Entity</span>
                <select
                  className="rounded border border-slate-200 bg-white px-3 py-2"
                  name="entity_code"
                  required
                >
                  <option value="IND">IND</option>
                  <option value="UAE">UAE</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="font-medium">Source</span>
                <select
                  className="rounded border border-slate-200 bg-white px-3 py-2"
                  name="source_hint"
                >
                  <option value="">Auto-detect</option>
                  <option value="TALLY">TALLY</option>
                  <option value="XERO">XERO</option>
                  <option value="CREDIT_PERIOD">CREDIT_PERIOD</option>
                </select>
              </label>
              <label className="grid gap-1">
                <span className="font-medium">As-of date</span>
                <input
                  className="rounded border border-slate-200 bg-white px-3 py-2"
                  name="as_of_date"
                  type="date"
                />
              </label>
              <label className="grid gap-1">
                <span className="font-medium">XLSX file</span>
                <input
                  accept=".xlsx,.xls"
                  className="rounded border border-slate-200 bg-white px-3 py-2"
                  name="file"
                  required
                  type="file"
                />
              </label>
              <button
                className="w-fit rounded bg-slate-900 px-4 py-2 text-white hover:bg-slate-800"
                type="submit"
              >
                Upload
              </button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import { UploadSnapshotForm } from "./_components/upload-snapshot-form";

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
            <UploadSnapshotForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

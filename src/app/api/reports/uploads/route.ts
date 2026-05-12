import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  entity: z.enum(["IND", "UAE"]).optional(),
});

/**
 * PR 6 — upload (snapshot) history XLSX. One row per snapshot regardless of
 * status, with the uploader, parsing summary, and publish/discard actor so
 * compliance can audit who uploaded what and when.
 *
 * Analysts are scoped to their entity; CFO/Admin see everything.
 */
export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const query = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const prisma = getPrisma();

    const where: Record<string, unknown> = {};
    if (query.entity) {
      where.entities = { is: { code: query.entity } };
    }
    if (currentUser.role === role_enum.ANALYST && currentUser.entityIdScope) {
      where.entity_id = currentUser.entityIdScope;
    }

    const snapshots = await prisma.snapshots.findMany({
      where,
      orderBy: { uploaded_at: "desc" },
      take: 1000,
      select: {
        id: true,
        as_of_date: true,
        source_hint: true,
        status: true,
        row_count: true,
        total_outstanding: true,
        uploaded_at: true,
        published_at: true,
        published_as: true,
        discarded_at: true,
        parse_result_json: true,
        entities: { select: { code: true } },
        users_snapshots_uploaded_byTousers: { select: { email: true } },
        users_snapshots_published_byTousers: { select: { email: true } },
        users_snapshots_discarded_byTousers: { select: { email: true } },
      },
    });

    function parseSummary(json: unknown): { warnings: number; errors: number } {
      if (!json || typeof json !== "object") return { warnings: 0, errors: 0 };
      const obj = json as { warnings?: unknown; errors?: unknown };
      return {
        warnings: Array.isArray(obj.warnings) ? obj.warnings.length : 0,
        errors: Array.isArray(obj.errors) ? obj.errors.length : 0,
      };
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Receivables";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Upload History");

    sheet.columns = [
      { header: "Entity", key: "entity", width: 10 },
      { header: "Snapshot ID", key: "id", width: 38 },
      { header: "Source", key: "source", width: 16 },
      { header: "As-of Date", key: "as_of_date", width: 14 },
      { header: "Status", key: "status", width: 14 },
      { header: "Rows", key: "row_count", width: 10 },
      { header: "Total Outstanding", key: "total_outstanding", width: 18 },
      { header: "Parse Warnings", key: "warnings", width: 14 },
      { header: "Parse Errors", key: "errors", width: 14 },
      { header: "Uploaded At", key: "uploaded_at", width: 22 },
      { header: "Uploaded By", key: "uploaded_by", width: 28 },
      { header: "Published At", key: "published_at", width: 22 },
      { header: "Published By", key: "published_by", width: 28 },
      { header: "Published As", key: "published_as", width: 14 },
      { header: "Discarded At", key: "discarded_at", width: 22 },
      { header: "Discarded By", key: "discarded_by", width: 28 },
    ];

    for (const snap of snapshots) {
      const summary = parseSummary(snap.parse_result_json);
      sheet.addRow({
        entity: snap.entities.code,
        id: snap.id,
        source: snap.source_hint,
        as_of_date: snap.as_of_date
          ? snap.as_of_date.toISOString().slice(0, 10)
          : "",
        status: snap.status,
        row_count: snap.row_count ?? 0,
        total_outstanding: snap.total_outstanding
          ? Number(snap.total_outstanding)
          : null,
        warnings: summary.warnings,
        errors: summary.errors,
        uploaded_at: snap.uploaded_at.toISOString(),
        uploaded_by: snap.users_snapshots_uploaded_byTousers?.email ?? "",
        published_at: snap.published_at
          ? snap.published_at.toISOString()
          : "",
        published_by: snap.users_snapshots_published_byTousers?.email ?? "",
        published_as: snap.published_as ?? "",
        discarded_at: snap.discarded_at
          ? snap.discarded_at.toISOString()
          : "",
        discarded_by: snap.users_snapshots_discarded_byTousers?.email ?? "",
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="upload-history.xlsx"',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

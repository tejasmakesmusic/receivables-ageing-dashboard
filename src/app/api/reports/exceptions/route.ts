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
  status: z.enum(["ACTIVE", "RESOLVED", "AUTO_RESOLVED", "ALL"]).default("ALL"),
});

/**
 * PR 6 — exception register XLSX. One row per exception_tag with the
 * surrounding invoice + party context, who tagged it, and (when resolved)
 * who closed it. Used for audit and quarterly write-off review.
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
    if (query.status !== "ALL") {
      where.status = query.status;
    }
    const invoiceFilter: Record<string, unknown> = {};
    if (query.entity) {
      invoiceFilter.entities = { is: { code: query.entity } };
    }
    if (currentUser.role === role_enum.ANALYST && currentUser.entityIdScope) {
      invoiceFilter.entity_id = currentUser.entityIdScope;
    }
    if (Object.keys(invoiceFilter).length > 0) {
      where.invoices = { is: invoiceFilter };
    }

    const tags = await prisma.exception_tags.findMany({
      where,
      orderBy: { tagged_at: "desc" },
      take: 5000,
      include: {
        exception_bucket_types: { select: { code: true, name: true } },
        invoices: {
          select: {
            invoice_ref: true,
            invoice_date: true,
            amount: true,
            currency: true,
            entities: { select: { code: true } },
            parties_canonical: { select: { name: true } },
          },
        },
        users_exception_tags_tagged_byTousers: { select: { email: true } },
        users_exception_tags_resolved_byTousers: { select: { email: true } },
      },
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Receivables";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Exception Register");

    sheet.columns = [
      { header: "Entity", key: "entity", width: 10 },
      { header: "Party", key: "party", width: 36 },
      { header: "Invoice Ref", key: "invoice_ref", width: 18 },
      { header: "Invoice Date", key: "invoice_date", width: 14 },
      { header: "Amount", key: "amount", width: 16 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Bucket", key: "bucket", width: 24 },
      { header: "Reason", key: "reason", width: 40 },
      { header: "Status", key: "status", width: 16 },
      { header: "Tagged At", key: "tagged_at", width: 22 },
      { header: "Tagged By", key: "tagged_by", width: 28 },
      { header: "Expected Resolution", key: "expected_resolution", width: 18 },
      { header: "Resolved At", key: "resolved_at", width: 22 },
      { header: "Resolved By", key: "resolved_by", width: 28 },
      { header: "Resolution Note", key: "resolution_note", width: 40 },
    ];

    for (const tag of tags) {
      sheet.addRow({
        entity: tag.invoices.entities.code,
        party: tag.invoices.parties_canonical.name,
        invoice_ref: tag.invoices.invoice_ref,
        invoice_date: tag.invoices.invoice_date.toISOString().slice(0, 10),
        amount: Number(tag.invoices.amount),
        currency: tag.invoices.currency,
        bucket: tag.exception_bucket_types.name,
        reason: tag.reason,
        status: tag.status,
        tagged_at: tag.tagged_at.toISOString(),
        tagged_by: tag.users_exception_tags_tagged_byTousers?.email ?? "",
        expected_resolution: tag.expected_resolution_date
          ? tag.expected_resolution_date.toISOString().slice(0, 10)
          : "",
        resolved_at: tag.resolved_at ? tag.resolved_at.toISOString() : "",
        resolved_by: tag.users_exception_tags_resolved_byTousers?.email ?? "",
        resolution_note: tag.resolution_note ?? "",
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="exception-register.xlsx"',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { listInvoices } from "@/server/invoices/service";

export const dynamic = "force-dynamic";

const reportQuerySchema = z.object({
  entity: z.enum(["IND", "UAE"]).optional(),
  status: z.enum(["OPEN", "SETTLED"]).default("OPEN"),
});

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );
    const query = reportQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const invoices = await listInvoices(
      {
        entity: query.entity,
        status: query.status,
        page: 1,
        page_size: 200,
      },
      currentUser,
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Receivables Dashboard";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Ageing Register");

    sheet.columns = [
      { header: "Entity", key: "entity", width: 10 },
      { header: "Party", key: "party", width: 36 },
      { header: "Invoice Ref", key: "invoiceRef", width: 18 },
      { header: "Invoice Date", key: "invoiceDate", width: 14 },
      { header: "Due Date", key: "dueDate", width: 14 },
      { header: "Amount", key: "amount", width: 16 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Overdue Days", key: "overdueDays", width: 14 },
      { header: "Bucket", key: "bucket", width: 12 },
      { header: "Active Exceptions", key: "activeExceptions", width: 18 },
      { header: "Status", key: "status", width: 12 },
    ];

    for (const invoice of invoices.items) {
      sheet.addRow({
        entity: invoice.entity_code,
        party: invoice.canonical_name,
        invoiceRef: invoice.invoice_ref,
        invoiceDate: invoice.invoice_date,
        dueDate: invoice.due_date,
        amount: Number(invoice.amount),
        currency: invoice.currency,
        overdueDays: invoice.overdue_days,
        bucket: invoice.bucket,
        activeExceptions: invoice.active_exception_count,
        status: invoice.status,
      });
    }

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="ageing-register.xlsx"',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { listInvoices } from "@/server/invoices/service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  entity: z.enum(["IND", "UAE"]).optional(),
});

/**
 * PR 6 — party-wise outstanding XLSX. Aggregates the OPEN-status invoices
 * per canonical party and breaks down by ageing bucket so finance can spot
 * concentration risk at a glance.
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

    // Pull the full open ledger (the aggregation cost is small at this scale;
    // if it grows, push the rollup into SQL).
    const invoices = await listInvoices(
      {
        entity: query.entity,
        status: "OPEN",
        page: 1,
        page_size: 10_000,
      },
      currentUser,
    );

    type PartyAgg = {
      entity: string;
      party: string;
      canonical_id: string;
      currency: string;
      not_due: number;
      due_today: number;
      bucket_0_30: number;
      bucket_31_60: number;
      bucket_61_90: number;
      bucket_90_plus: number;
      total: number;
      invoice_count: number;
      active_exceptions: number;
    };
    const byParty = new Map<string, PartyAgg>();
    for (const inv of invoices.items) {
      const amount = Number(inv.amount) || 0;
      const key = inv.canonical_id;
      const existing =
        byParty.get(key) ??
        ({
          entity: inv.entity_code,
          party: inv.canonical_name,
          canonical_id: inv.canonical_id,
          currency: inv.currency,
          not_due: 0,
          due_today: 0,
          bucket_0_30: 0,
          bucket_31_60: 0,
          bucket_61_90: 0,
          bucket_90_plus: 0,
          total: 0,
          invoice_count: 0,
          active_exceptions: 0,
        } satisfies PartyAgg);
      existing.total += amount;
      existing.invoice_count += 1;
      existing.active_exceptions += inv.active_exception_count;
      switch (inv.bucket) {
        case "NOT_DUE":
          existing.not_due += amount;
          break;
        case "DUE_TODAY":
          existing.due_today += amount;
          break;
        case "0_30":
          existing.bucket_0_30 += amount;
          break;
        case "31_60":
          existing.bucket_31_60 += amount;
          break;
        case "61_90":
          existing.bucket_61_90 += amount;
          break;
        case "90_PLUS":
          existing.bucket_90_plus += amount;
          break;
      }
      byParty.set(key, existing);
    }
    const rows = Array.from(byParty.values()).sort(
      (a, b) => b.total - a.total,
    );

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Receivables";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Party Outstanding");

    sheet.columns = [
      { header: "Entity", key: "entity", width: 10 },
      { header: "Party", key: "party", width: 36 },
      { header: "Currency", key: "currency", width: 10 },
      { header: "Not Due", key: "not_due", width: 14 },
      { header: "Due Today", key: "due_today", width: 14 },
      { header: "1-30", key: "bucket_0_30", width: 14 },
      { header: "31-60", key: "bucket_31_60", width: 14 },
      { header: "61-90", key: "bucket_61_90", width: 14 },
      { header: "90+", key: "bucket_90_plus", width: 14 },
      { header: "Total Outstanding", key: "total", width: 18 },
      { header: "Open Invoices", key: "invoice_count", width: 14 },
      { header: "Active Exceptions", key: "active_exceptions", width: 18 },
    ];
    for (const row of rows) sheet.addRow(row);

    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="party-outstanding.xlsx"',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

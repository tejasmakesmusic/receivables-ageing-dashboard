import {
  makeParseError,
  makeParseResult,
  parseDateCell,
  type ParsedInvoiceRow,
  type ParseResult,
} from "@/server/parsers/common";
import type { XeroInvoice } from "@/server/xero/types";

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseXeroDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  try {
    return parseDateCell(value);
  } catch {
    return null;
  }
}

function decimalText(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value.toFixed(2);
}

function stringifyRecord(invoice: XeroInvoice): Record<string, string | null> {
  return {
    InvoiceID: invoice.InvoiceID ?? null,
    InvoiceNumber: invoice.InvoiceNumber ?? null,
    Type: invoice.Type ?? null,
    Status: invoice.Status ?? null,
    ContactID: invoice.Contact?.ContactID ?? null,
    ContactName: invoice.Contact?.Name ?? null,
    ContactNumber: invoice.Contact?.ContactNumber ?? null,
    EmailAddress: invoice.Contact?.EmailAddress ?? null,
    Date: invoice.Date ?? null,
    DateString: invoice.DateString ?? null,
    DueDate: invoice.DueDate ?? null,
    DueDateString: invoice.DueDateString ?? null,
    AmountDue:
      typeof invoice.AmountDue === "number" ? String(invoice.AmountDue) : null,
    Total: typeof invoice.Total === "number" ? String(invoice.Total) : null,
    CurrencyCode: invoice.CurrencyCode ?? null,
    Reference: invoice.Reference ?? null,
    SentToContact:
      typeof invoice.SentToContact === "boolean"
        ? String(invoice.SentToContact)
        : null,
    UpdatedDateUTC: invoice.UpdatedDateUTC ?? null,
  };
}

function missingRequiredFields(invoice: XeroInvoice): string[] {
  const missing: string[] = [];
  if (!invoice.Contact?.Name?.trim()) missing.push("Contact.Name");
  if (!invoice.InvoiceNumber?.trim()) missing.push("InvoiceNumber");
  if (!invoice.DateString && !invoice.Date) missing.push("Date");
  if (typeof invoice.AmountDue !== "number") missing.push("AmountDue");
  return missing;
}

function normalizeInvoice(
  invoice: XeroInvoice,
  index: number,
): ParsedInvoiceRow {
  const rowIndex = index + 1;
  const rawRow = stringifyRecord(invoice);
  const invoiceDate = parseXeroDate(invoice.DateString ?? invoice.Date);
  const required = missingRequiredFields(invoice);

  let parseError: string | null = null;
  if (required.length > 0) {
    parseError = `Missing required Xero fields: ${required.join(", ")}`;
  } else if (!invoiceDate) {
    parseError = "Could not parse Xero invoice date";
  } else if (invoice.CurrencyCode !== "AED") {
    parseError = `Unsupported Xero invoice currency: ${invoice.CurrencyCode ?? "missing"}`;
  }

  return {
    row_index: rowIndex,
    status: parseError ? "PARSE_ERROR" : "OK",
    source_currency: "AED",
    party_name_raw: invoice.Contact?.Name ?? "",
    gstin: null,
    xero_contact_id: invoice.Contact?.ContactID ?? null,
    invoice_ref: invoice.InvoiceNumber ?? null,
    invoice_date: invoiceDate,
    amount: decimalText(invoice.AmountDue),
    raw_row_json: rawRow,
    xero_metadata: {
      invoice_seen: null,
      invoice_sent:
        typeof invoice.SentToContact === "boolean"
          ? String(invoice.SentToContact)
          : null,
      project_id: invoice.Reference ?? null,
      service_month: null,
      primary_person: null,
      email: invoice.Contact?.EmailAddress ?? null,
    },
    parse_error_reason: parseError,
  };
}

export function normalizeXeroInvoicesToParseResult(input: {
  invoices: XeroInvoice[];
  pulledAt: Date;
  fileSha256: string;
}): ParseResult {
  // Filter to open ACCREC invoices before the row index is assigned so
  // rejected lines (voided, deleted, paid) aren't counted as PARSE_ERROR.
  const openInvoices = input.invoices.filter((invoice) => {
    if (invoice.Type !== "ACCREC") return false;
    if (invoice.Status === "VOIDED" || invoice.Status === "DELETED") {
      return false;
    }
    return typeof invoice.AmountDue === "number" && invoice.AmountDue > 0;
  });
  const rows = openInvoices.map(normalizeInvoice);
  const errors = rows
    .filter((row) => row.status === "PARSE_ERROR")
    .map((row) =>
      makeParseError(
        row.row_index,
        "XERO_API_ROW_PARSE_ERROR",
        row.parse_error_reason ?? "Xero row could not be normalized",
        { invoice_ref: row.invoice_ref, xero_contact_id: row.xero_contact_id },
      ),
    );

  return makeParseResult({
    invoices: rows,
    errors,
    warnings: [
      {
        row_index: -1,
        code: "XERO_API_SOURCE",
        message: `Xero API pull normalized on ${input.pulledAt.toISOString()}`,
        detail: {
          source_origin: "XERO_API",
          pulled_at: input.pulledAt.toISOString(),
        },
      },
    ],
    as_of_date: new Date(`${dateOnly(input.pulledAt)}T00:00:00.000Z`),
    file_sha256: input.fileSha256,
    source_hint: "XERO",
  });
}

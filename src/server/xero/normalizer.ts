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
    CurrencyRate:
      typeof invoice.CurrencyRate === "number"
        ? String(invoice.CurrencyRate)
        : null,
    Reference: invoice.Reference ?? null,
    SentToContact:
      typeof invoice.SentToContact === "boolean"
        ? String(invoice.SentToContact)
        : null,
    UpdatedDateUTC: invoice.UpdatedDateUTC ?? null,
  };
}

function missingRequiredFields(invoice: XeroInvoice): string[] {
  // Only structural blockers — fields without which we literally cannot
  // stage the row. Currency-specific checks moved out (multi-currency
  // is allowed per 2026-05-16 UAT feedback) and CurrencyCode itself is
  // also required because the published `invoices.currency` column is
  // NOT NULL VARCHAR(3).
  const missing: string[] = [];
  if (!invoice.Contact?.Name?.trim()) missing.push("Contact.Name");
  if (!invoice.InvoiceNumber?.trim()) missing.push("InvoiceNumber");
  if (!invoice.DateString && !invoice.Date) missing.push("Date");
  if (typeof invoice.AmountDue !== "number") missing.push("AmountDue");
  if (!invoice.CurrencyCode?.trim()) missing.push("CurrencyCode");
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
  }

  // Xero `CurrencyRate` is the multiplier from invoice currency to org
  // base currency at the time of posting. Capture it as authoritative
  // for this invoice (analysts may still apply our internal FX rates
  // for cross-entity reporting, but the per-invoice GL match should
  // use Xero's number).
  const currencyRate =
    typeof invoice.CurrencyRate === "number" &&
    Number.isFinite(invoice.CurrencyRate)
      ? invoice.CurrencyRate.toString()
      : null;

  return {
    row_index: rowIndex,
    status: parseError ? "PARSE_ERROR" : "OK",
    source_currency: invoice.CurrencyCode?.trim() || "AED",
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
      currency_rate: currencyRate,
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
  // rejected lines (voided, deleted, paid, draft, submitted) aren't
  // counted as PARSE_ERROR. We restrict to AUTHORISED to mirror Xero's
  // "Aged Receivables Detail" report — DRAFT/SUBMITTED rows are present
  // in the /Invoices API response but excluded from the AR report, so
  // including them here causes the staging total to overshoot the
  // analyst's reference report.
  const openInvoices = input.invoices.filter((invoice) => {
    if (invoice.Type !== "ACCREC") return false;
    if (invoice.Status !== "AUTHORISED") return false;
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

  // No synthetic warnings here — the API origin is already captured in
  // `source_hint = "XERO"`, the snapshot's audit row's `source_origin`
  // field, and the persisted source artifact JSON. Emitting a warning
  // just to record provenance was forcing analysts to "acknowledge"
  // every Xero pull before publish, which is pure noise.
  return makeParseResult({
    invoices: rows,
    errors,
    warnings: [],
    as_of_date: new Date(`${dateOnly(input.pulledAt)}T00:00:00.000Z`),
    file_sha256: input.fileSha256,
    source_hint: "XERO",
  });
}

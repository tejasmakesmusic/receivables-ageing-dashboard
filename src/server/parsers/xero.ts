import * as XLSX from "xlsx";

import {
  ParseErrorRow,
  ParseResult,
  ParsedInvoiceRow,
  MonetaryValue,
  ParseWarning,
  SourceHint,
  computeFileSha256,
  isEmptyCell,
  makeParseError,
  makeParseWarning,
  parseDateCell,
  parseScaledAmount,
  scaledToDecimalString,
  stringifyCell,
  addScaled,
} from "./common";

const SHEET_NAME = "Aged Receivables Detail";
const HEADER_ROW_IDX = 5;
const DATA_START_ROW = 6;
const INVOICE_SEEN_HIGH_THRESHOLD = 0.2;

const COL_CONTACT_ACCOUNT_NUMBER = "Contact Account Number";
const COL_PRIMARY_PERSON = "Primary Person";
const COL_INVOICE_DATE = "Invoice Date";
const COL_INVOICE_NUMBER = "Invoice Number";
const COL_TOTAL = "Total";
const COL_INVOICE_SEEN = "Invoice Seen";
const COL_INVOICE_SENT = "Invoice Sent";
const COL_PROJECT_ID = "PROJECT ID";
const COL_SERVICE_MONTH = "SERVICE MONTH";
const COL_EMAIL = "Email";

const REQUIRED_COLUMNS = [
  COL_CONTACT_ACCOUNT_NUMBER,
  COL_INVOICE_DATE,
  COL_INVOICE_NUMBER,
  COL_TOTAL,
];

const AS_OF_DATE_RE = /as\s+at\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})/i;

const XERO_META_KEYS: Array<{
  key: keyof NonNullable<ParsedInvoiceRow["xero_metadata"]>;
  colName: string;
}> = [
  { key: "invoice_seen", colName: COL_INVOICE_SEEN },
  { key: "invoice_sent", colName: COL_INVOICE_SENT },
  { key: "project_id", colName: COL_PROJECT_ID },
  { key: "service_month", colName: COL_SERVICE_MONTH },
  { key: "primary_person", colName: COL_PRIMARY_PERSON },
  { key: "email", colName: COL_EMAIL },
];

type RowWithIndex = {
  rawIndex: number;
  row: unknown[];
};

function buildColMap(headerRow: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((value, idx) => {
    if (typeof value === "string") {
      const key = value.trim();
      if (key.length) {
        map[key] = idx;
      }
    }
  });
  return map;
}

function buildRawJson(
  row: unknown[],
  headerOrder: string[],
  colMap: Record<string, number>,
): Record<string, string | null> {
  const output: Record<string, string | null> = {};
  for (const name of headerOrder) {
    output[name] = stringifyCell(row[colMap[name]]);
  }
  return output;
}

function rowToMetadata(
  row: unknown[],
  colMap: Record<string, number>,
): ParsedInvoiceRow["xero_metadata"] {
  const metadata: ParsedInvoiceRow["xero_metadata"] = {
    invoice_seen: null,
    invoice_sent: null,
    project_id: null,
    service_month: null,
    primary_person: null,
    email: null,
  };

  for (const { key, colName } of XERO_META_KEYS) {
    if (colName in colMap) {
      metadata[key] = stringifyCell(row[colMap[colName]]);
    }
  }

  return metadata;
}

function isBlankRow(row: unknown[], colMap: Record<string, number>): boolean {
  return Object.values(colMap).every((colIdx) => isEmptyCell(row[colIdx]));
}

function isPartySubtotal(row: unknown[], contactCol: number): boolean {
  const value = row[contactCol];
  return typeof value === "string" && value.startsWith("Total ");
}

function isGrandTotal(row: unknown[], contactCol: number): boolean {
  const value = row[contactCol];
  return typeof value === "string" && value.trim() === "Total";
}

function isPartyHeader(
  row: unknown[],
  contactCol: number,
  invoiceDateCol: number | undefined,
): boolean {
  const contact = row[contactCol];
  if (isEmptyCell(contact)) {
    return false;
  }

  if (typeof contact === "string" && contact.trim().startsWith("Total")) {
    return false;
  }

  if (invoiceDateCol === undefined) {
    return true;
  }

  return isEmptyCell(row[invoiceDateCol]);
}

function isInvoiceRow(
  row: unknown[],
  invoiceDateCol: number | undefined,
  invoiceNumberCol: number | undefined,
): boolean {
  return (
    invoiceDateCol !== undefined &&
    invoiceNumberCol !== undefined &&
    !isEmptyCell(row[invoiceDateCol]) &&
    !isEmptyCell(row[invoiceNumberCol])
  );
}

function isCreditNoteRow(
  row: unknown[],
  invoiceDateCol: number | undefined,
  invoiceNumberCol: number | undefined,
): boolean {
  return (
    invoiceDateCol !== undefined &&
    invoiceNumberCol !== undefined &&
    !isEmptyCell(row[invoiceDateCol]) &&
    isEmptyCell(row[invoiceNumberCol])
  );
}

function sniffAsOfDate(rows: unknown[][]): Date | null {
  const candidate = rows[2]?.[0];
  if (isEmptyCell(candidate)) {
    return null;
  }
  const text = String(candidate).trim();
  const match = AS_OF_DATE_RE.exec(text);
  if (!match) {
    return null;
  }
  const dateText = match[1];
  const parsed = new Date(dateText);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return new Date(
    Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
  );
}

function parseXeroMetadataRow(row: unknown[], colMap: Record<string, number>) {
  return rowToMetadata(row, colMap);
}

export function parseXeroAgedReceivables(
  fileBytes: ArrayBuffer | Uint8Array,
): ParseResult {
  const fileSha = computeFileSha256(fileBytes);
  const resultSourceHint: SourceHint = "XERO";
  const invoices: ParsedInvoiceRow[] = [];
  const errors: ParseErrorRow[] = [];
  const warnings: ParseWarning[] = [];

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(fileBytes, { type: "array" });
  } catch (error) {
    errors.push(
      makeParseError(
        -1,
        "SHEET_NOT_FOUND",
        `Cannot open workbook: ${String((error as Error).message ?? error)}`,
      ),
    );
    return {
      invoices,
      credit_periods: [],
      errors,
      warnings,
      as_of_date: null,
      file_sha256: fileSha,
      source_hint: resultSourceHint,
      is_valid: errors.length === 0,
    };
  }

  const sheet = workbook.Sheets[SHEET_NAME];
  if (!sheet) {
    errors.push(
      makeParseError(
        -1,
        "SHEET_NOT_FOUND",
        `Cannot open sheet '${SHEET_NAME}' in workbook.`,
      ),
    );
    return {
      invoices,
      credit_periods: [],
      errors,
      warnings,
      as_of_date: null,
      file_sha256: fileSha,
      source_hint: resultSourceHint,
      is_valid: errors.length === 0,
    };
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  }) as unknown[][];

  const asOfDate = sniffAsOfDate(rows);
  if (asOfDate === null) {
    warnings.push(
      makeParseWarning(
        2,
        "AS_OF_DATE_SNIFF_FAILED",
        "Could not parse 'As at DD Month YYYY' from row 2 of the Xero sheet.",
      ),
    );
  }

  if (rows.length <= HEADER_ROW_IDX) {
    errors.push(
      makeParseError(
        -1,
        "UNEXPECTED_SHAPE",
        `Sheet has only ${rows.length} rows; expected at least ${HEADER_ROW_IDX + 1} (header on row ${HEADER_ROW_IDX}).`,
      ),
    );
    return {
      invoices,
      credit_periods: [],
      errors,
      warnings,
      as_of_date: asOfDate,
      file_sha256: fileSha,
      source_hint: resultSourceHint,
      is_valid: errors.length === 0,
    };
  }

  const headerRow = rows[HEADER_ROW_IDX] ?? [];
  const colMap = buildColMap(Array.isArray(headerRow) ? headerRow : []);

  const missingColumns = REQUIRED_COLUMNS.filter(
    (column) => !(column in colMap),
  );
  if (missingColumns.length > 0) {
    errors.push(
      makeParseError(
        -1,
        "MISSING_REQUIRED_COLUMN",
        `Required Xero columns absent: ${missingColumns.join(", ")}`,
        {
          missing: missingColumns,
          header_row_index: HEADER_ROW_IDX,
        },
      ),
    );
    return {
      invoices,
      credit_periods: [],
      errors,
      warnings,
      as_of_date: asOfDate,
      file_sha256: fileSha,
      source_hint: resultSourceHint,
      is_valid: errors.length === 0,
    };
  }

  const contactCol = colMap[COL_CONTACT_ACCOUNT_NUMBER];
  const invoiceDateCol = colMap[COL_INVOICE_DATE];
  const invoiceNumberCol = colMap[COL_INVOICE_NUMBER];
  const totalCol = colMap[COL_TOTAL];

  const namedColumns = Object.entries(colMap)
    .filter(([, idx]) => idx >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);

  const rowsWithIndex: RowWithIndex[] = rows.map((row, rawIndex) => ({
    rawIndex,
    row: Array.isArray(row) ? row : [],
  }));

  let grandTotalRowIdx: number | null = null;
  let grandTotalValue: bigint | null = null;
  for (const { rawIndex, row } of rowsWithIndex.slice(DATA_START_ROW)) {
    if (!isGrandTotal(row, contactCol)) {
      continue;
    }
    grandTotalRowIdx = rawIndex;
    const total = parseScaledAmount(row[totalCol]);
    if (total) {
      grandTotalValue = total.scaled;
    }
    break;
  }

  let currentParty: string | null = null;
  let pastGrandTotal = false;
  const okInvoices: ParsedInvoiceRow[] = [];

  for (const { rawIndex, row } of rowsWithIndex.slice(DATA_START_ROW)) {
    if (pastGrandTotal) {
      continue;
    }

    const rawJson = buildRawJson(row, namedColumns, colMap);

    if (isGrandTotal(row, contactCol)) {
      pastGrandTotal = true;
      continue;
    }

    if (isBlankRow(row, colMap)) {
      continue;
    }

    if (isPartySubtotal(row, contactCol)) {
      continue;
    }

    if (isPartyHeader(row, contactCol, invoiceDateCol)) {
      currentParty = stringifyCell(row[contactCol]) ?? "";
      continue;
    }

    if (isInvoiceRow(row, invoiceDateCol, invoiceNumberCol)) {
      const reasonParts: string[] = [];
      const rawMetadata = parseXeroMetadataRow(row, colMap);

      let invoiceDate: Date | null = null;
      let amountScaled: bigint | null = null;

      try {
        invoiceDate = parseDateCell(row[invoiceDateCol]);
      } catch (error) {
        reasonParts.push((error as Error).message || "Invalid invoice date");
      }

      if (invoiceDate === null) {
        reasonParts.push(`Invoice Date is empty at row ${rawIndex}`);
      }

      const amountParsed = parseScaledAmount(row[totalCol]);
      if (!amountParsed) {
        reasonParts.push(`Total is empty or invalid at row ${rawIndex}`);
      } else {
        amountScaled = amountParsed.scaled;
      }

      if (
        reasonParts.length > 0 ||
        invoiceDate === null ||
        amountScaled === null
      ) {
        invoices.push({
          row_index: rawIndex,
          status: "PARSE_ERROR",
          source_currency: "AED",
          party_name_raw: currentParty ?? "",
          invoice_ref: null,
          invoice_date: null,
          amount: null,
          raw_row_json: rawJson,
          xero_metadata: rawMetadata,
          parse_error_reason: reasonParts.join("; "),
        });
        continue;
      }

      const invoiceRef = stringifyCell(row[invoiceNumberCol]);

      invoices.push({
        row_index: rawIndex,
        status: "OK",
        source_currency: "AED",
        party_name_raw: currentParty ?? "",
        invoice_ref: invoiceRef,
        invoice_date: invoiceDate,
        amount: scaledToDecimalString(amountScaled),
        raw_row_json: rawJson,
        xero_metadata: rawMetadata,
        parse_error_reason: null,
      });
      okInvoices.push(invoices[invoices.length - 1]);
      continue;
    }

    if (isCreditNoteRow(row, invoiceDateCol, invoiceNumberCol)) {
      invoices.push({
        row_index: rawIndex,
        status: "PARSE_ERROR",
        source_currency: "AED",
        party_name_raw: currentParty ?? "",
        invoice_ref: null,
        invoice_date: null,
        amount: null,
        raw_row_json: rawJson,
        xero_metadata: parseXeroMetadataRow(row, colMap),
        parse_error_reason: "no invoice number (credit note / adjustment)",
      });
      continue;
    }

    invoices.push({
      row_index: rawIndex,
      status: "PARSE_ERROR",
      source_currency: "AED",
      party_name_raw: currentParty ?? "",
      invoice_ref: null,
      invoice_date: null,
      amount: null,
      raw_row_json: rawJson,
      xero_metadata: parseXeroMetadataRow(row, colMap),
      parse_error_reason: `Row ${rawIndex} has unexpected shape: not invoice, party header, sub-total, grand total, credit note, or blank.`,
    });
  }

  const sumOfInvoiceTotals = addScaled(
    okInvoices
      .filter(
        (invoice): invoice is ParsedInvoiceRow & { amount: string } =>
          invoice.amount !== null,
      )
      .map((invoice) => parseScaledAmount(invoice.amount))
      .filter((value): value is MonetaryValue => value !== null)
      .map((value) => value.scaled),
  );

  if (grandTotalValue !== null) {
    const delta =
      sumOfInvoiceTotals > grandTotalValue
        ? sumOfInvoiceTotals - grandTotalValue
        : grandTotalValue - sumOfInvoiceTotals;

    if (delta > 1_000_000n) {
      warnings.push(
        makeParseWarning(
          grandTotalRowIdx ?? -1,
          "GRAND_TOTAL_MISMATCH",
          `Sum of invoice totals (${scaledToDecimalString(
            sumOfInvoiceTotals,
          )}) differs from grand total (${scaledToDecimalString(
            grandTotalValue,
          )}) by ${scaledToDecimalString(delta)} (> AED 1 tolerance; expected for Xero overdue-only total)`,
          {
            sum_of_invoices: scaledToDecimalString(sumOfInvoiceTotals),
            grand_total: scaledToDecimalString(grandTotalValue),
            delta: scaledToDecimalString(delta),
          },
        ),
      );
    }
  }

  if (okInvoices.length > 0) {
    const notSeenCount = okInvoices.filter(
      (invoice) => invoice.xero_metadata?.invoice_seen === "Not seen",
    ).length;
    const notSeenRate = notSeenCount / okInvoices.length;
    if (notSeenRate > INVOICE_SEEN_HIGH_THRESHOLD) {
      warnings.push(
        makeParseWarning(
          -1,
          "INVOICE_SEEN_HIGH",
          `${notSeenCount} of ${okInvoices.length} OK invoices (${(notSeenRate * 100).toFixed(1)}%) have Invoice Seen = 'Not seen' (threshold 20%)`,
          {
            not_seen_count: notSeenCount,
            total: okInvoices.length,
            percentage: notSeenRate,
          },
        ),
      );
    }
  }

  return {
    invoices,
    credit_periods: [],
    errors,
    warnings,
    as_of_date: asOfDate,
    file_sha256: fileSha,
    source_hint: resultSourceHint,
    is_valid: errors.length === 0,
  };
}

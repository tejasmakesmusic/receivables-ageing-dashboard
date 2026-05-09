import * as XLSX from "xlsx";

import {
  ParseErrorRow,
  ParseResult,
  ParsedInvoiceRow,
  ParseWarning,
  SourceHint,
  AMOUNT_SCALE_FACTOR,
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

const SHEET_NAME = "Sundry Debtors";
const HEADER_ROWS = 5;

// GSTIN format: 2-digit state code + 10-char PAN + 1-char entity + 1-char Z + 1-char check digit
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

function extractGstin(value: unknown): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return GSTIN_REGEX.test(trimmed) ? trimmed : null;
}

// Column positions vary by whether the Tally export includes a GSTIN column.
// 7-col format: Date | Ref No. | Party Name | Opening | Pending | Due On | Overdue Days
// 8-col format: Date | Ref No. | Party Name | GSTIN   | Opening | Pending | Due On | Overdue Days
type RowMap = {
  date: number;
  ref_no: number;
  party_name: number;
  gstin: number; // -1 means not present
  opening_amount: number;
  pending_amount: number;
  due_on: number;
  overdue_days: number;
};

const ROW_MAP_7: RowMap = {
  date: 0,
  ref_no: 1,
  party_name: 2,
  gstin: -1,
  opening_amount: 3,
  pending_amount: 4,
  due_on: 5,
  overdue_days: 6,
};

const ROW_MAP_8: RowMap = {
  date: 0,
  ref_no: 1,
  party_name: 2,
  gstin: 3,
  opening_amount: 4,
  pending_amount: 5,
  due_on: 6,
  overdue_days: 7,
};

function normalizeRow(
  row: unknown[],
  minLength: number,
): (unknown | null)[] {
  const result = row.slice();
  while (result.length < minLength) result.push(null);
  return result.map((value) => (isEmptyCell(value) ? null : value));
}

function detectRowMap(rows: (unknown | null)[][]): RowMap {
  for (let idx = HEADER_ROWS; idx < rows.length; idx++) {
    const row = rows[idx];
    // Party header rows: col 0 empty, col 1 empty, col 2 (party name) non-empty
    if (
      isEmptyCell(row[0]) &&
      isEmptyCell(row[1]) &&
      !isEmptyCell(row[2]) &&
      extractGstin(row[3])
    ) {
      return ROW_MAP_8;
    }
  }
  return ROW_MAP_7;
}

function rowToRawJson(
  row: (unknown | null)[],
  rm: RowMap,
): Record<string, string | null> {
  const base: Record<string, string | null> = {
    date: stringifyCell(row[rm.date]),
    ref_no: stringifyCell(row[rm.ref_no]),
    party_name: stringifyCell(row[rm.party_name]),
    opening_amount: stringifyCell(row[rm.opening_amount]),
    pending_amount: stringifyCell(row[rm.pending_amount]),
    due_on: stringifyCell(row[rm.due_on]),
    overdue_days: stringifyCell(row[rm.overdue_days]),
  };
  if (rm.gstin >= 0) {
    base.gstin = stringifyCell(row[rm.gstin]);
  }
  return base;
}

function isPartyHeader(row: (unknown | null)[], rm: RowMap): boolean {
  return (
    !isEmptyCell(row[rm.party_name]) &&
    isEmptyCell(row[rm.date]) &&
    isEmptyCell(row[rm.ref_no])
  );
}

function isInvoiceRow(row: (unknown | null)[], rm: RowMap): boolean {
  return !isEmptyCell(row[rm.date]) && !isEmptyCell(row[rm.ref_no]);
}

function isBlankRow(row: (unknown | null)[], rm: RowMap): boolean {
  return (
    isEmptyCell(row[rm.date]) &&
    isEmptyCell(row[rm.ref_no]) &&
    isEmptyCell(row[rm.party_name]) &&
    isEmptyCell(row[rm.opening_amount]) &&
    isEmptyCell(row[rm.pending_amount])
  );
}

function isSubtotalOrGrandTotal(row: (unknown | null)[], rm: RowMap): boolean {
  return (
    isEmptyCell(row[rm.date]) &&
    isEmptyCell(row[rm.ref_no]) &&
    isEmptyCell(row[rm.party_name]) &&
    (!isEmptyCell(row[rm.opening_amount]) || !isEmptyCell(row[rm.pending_amount]))
  );
}

function detectGrandTotal(
  rows: (unknown | null)[][],
  rm: RowMap,
): [number | null, bigint | null] {
  const subtotalRows: Array<[number, bigint]> = [];

  for (let idx = HEADER_ROWS; idx < rows.length; idx += 1) {
    const row = rows[idx];
    if (!isSubtotalOrGrandTotal(row, rm)) continue;
    const pending = parseScaledAmount(row[rm.pending_amount]);
    if (!pending) continue;
    subtotalRows.push([idx, pending.scaled]);
  }

  if (!subtotalRows.length) return [null, null];

  const [rowIndex, pendingScaled] = subtotalRows[subtotalRows.length - 1];
  return [rowIndex, pendingScaled];
}

function amountDeltaString(delta: bigint): string {
  const abs = delta < 0n ? -delta : delta;
  return scaledToDecimalString(abs);
}

export function parseTallyGrpbills(
  fileBytes: ArrayBuffer | Uint8Array,
): ParseResult {
  const fileSha = computeFileSha256(fileBytes);
  const resultSourceHint: SourceHint = "TALLY";
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

  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  }) as unknown[][];

  // Detect whether the file has a GSTIN column (8-col) or not (7-col)
  const probeRows = rawRows.map((row) =>
    normalizeRow(Array.isArray(row) ? row : [], 9),
  );
  const rm = detectRowMap(probeRows);
  const minCols = rm.gstin >= 0 ? 8 : 7;

  const maxCols = rawRows.reduce((acc, row) => Math.max(acc, row.length), 0);
  if (maxCols < minCols - 1) {
    // Allow one column short as a soft tolerance
    errors.push(
      makeParseError(
        -1,
        "UNEXPECTED_SHAPE",
        `Sheet has ${maxCols} columns; expected at least ${minCols}.`,
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

  const normalizedRows = rawRows.map((row) =>
    normalizeRow(Array.isArray(row) ? row : [], minCols),
  );

  const [grandTotalRowIdx, grandTotalPending] = detectGrandTotal(
    normalizedRows,
    rm,
  );

  const partyInvoiceSums = new Map<string, bigint>();
  const partySubtotals = new Map<string, bigint | null>();
  const partySubtotalRows = new Map<string, number>();
  const partyOrder: string[] = [];
  let currentParty: string | null = null;
  let currentPartyGstin: string | null = null;

  for (let rawIdx = HEADER_ROWS; rawIdx < normalizedRows.length; rawIdx += 1) {
    if (rawIdx === grandTotalRowIdx) continue;

    const row = normalizedRows[rawIdx];

    if (isBlankRow(row, rm)) continue;

    if (isPartyHeader(row, rm)) {
      currentParty = stringifyCell(row[rm.party_name]);
      currentPartyGstin =
        rm.gstin >= 0 ? extractGstin(row[rm.gstin]) : null;
      if (currentParty && !partyInvoiceSums.has(currentParty)) {
        partyInvoiceSums.set(currentParty, 0n);
        partyOrder.push(currentParty);
      }
      continue;
    }

    if (isSubtotalOrGrandTotal(row, rm)) {
      if (currentParty !== null && !partySubtotals.has(currentParty)) {
        const pending = parseScaledAmount(row[rm.pending_amount]);
        partySubtotals.set(currentParty, pending?.scaled ?? null);
        partySubtotalRows.set(currentParty, rawIdx);
      }
      continue;
    }

    if (isInvoiceRow(row, rm)) {
      const refRaw = row[rm.ref_no];
      const dateRaw = row[rm.date];
      const party = currentParty ?? "";
      const pendingRaw = row[rm.pending_amount];
      const rawJsonForRow = rowToRawJson(row, rm);

      let invoiceDate: Date | null = null;
      let amountScaled: bigint | null = null;
      const parseErrorParts: string[] = [];
      try {
        invoiceDate = parseDateCell(dateRaw);
      } catch (error) {
        parseErrorParts.push((error as Error).message || "Invalid date");
      }

      if (invoiceDate === null) {
        parseErrorParts.push(`date is empty at row ${rawIdx}`);
      }

      const parsedAmount = parseScaledAmount(pendingRaw);
      if (!parsedAmount) {
        parseErrorParts.push(`pending_amount is invalid at row ${rawIdx}`);
      } else {
        amountScaled = parsedAmount.scaled;
      }

      const invoiceRef = stringifyCell(refRaw);
      if (!invoiceRef) {
        parseErrorParts.push(`ref_no is blank at row ${rawIdx}`);
      }

      if (
        parseErrorParts.length > 0 ||
        invoiceDate === null ||
        amountScaled === null
      ) {
        invoices.push({
          row_index: rawIdx,
          status: "PARSE_ERROR",
          source_currency: "INR",
          party_name_raw: party,
          gstin: currentPartyGstin,
          xero_contact_id: null,
          invoice_ref: null,
          invoice_date: null,
          amount: null,
          raw_row_json: rawJsonForRow,
          xero_metadata: null,
          parse_error_reason: parseErrorParts.join("; "),
        });
        continue;
      }

      invoices.push({
        row_index: rawIdx,
        status: "OK",
        source_currency: "INR",
        party_name_raw: party,
        gstin: currentPartyGstin,
        xero_contact_id: null,
        invoice_ref: invoiceRef,
        invoice_date: invoiceDate,
        amount: scaledToDecimalString(amountScaled),
        raw_row_json: rawJsonForRow,
        xero_metadata: null,
        parse_error_reason: null,
      });

      if (currentParty) {
        const running = partyInvoiceSums.get(currentParty) ?? 0n;
        partyInvoiceSums.set(currentParty, running + amountScaled);
      }

      continue;
    }

    invoices.push({
      row_index: rawIdx,
      status: "PARSE_ERROR",
      source_currency: "INR",
      party_name_raw: currentParty ?? "",
      gstin: currentPartyGstin,
      xero_contact_id: null,
      invoice_ref: null,
      invoice_date: null,
      amount: null,
      raw_row_json: rowToRawJson(row, rm),
      xero_metadata: null,
      parse_error_reason: `Row ${rawIdx} has unexpected shape: not invoice, party header, subtotal, or blank.`,
    });
  }

  for (const party of partyOrder) {
    const partySubtotal = partySubtotals.get(party);
    if (partySubtotal === undefined || partySubtotal === null) continue;

    const invoiceSum = partyInvoiceSums.get(party) ?? 0n;
    const delta =
      invoiceSum > partySubtotal
        ? invoiceSum - partySubtotal
        : partySubtotal - invoiceSum;
    if (delta > AMOUNT_SCALE_FACTOR * TOLERANCE) {
      warnings.push(
        makeParseWarning(
          partySubtotalRows.get(party) ?? -1,
          "SUBTOTAL_MISMATCH",
          `Party sub-total pending differs from sum of invoice pending by ${amountDeltaString(delta)} (> ₹1 tolerance)`,
          {
            party,
            subtotal_value: scaledToDecimalString(partySubtotal),
            sum_of_rows: scaledToDecimalString(invoiceSum),
          },
        ),
      );
    }
  }

  const okInvoicesSum = addScaled(
    invoices
      .filter(
        (invoice): invoice is ParsedInvoiceRow & { amount: string } =>
          invoice.status === "OK" && invoice.amount !== null,
      )
      .map((invoice) => parseScaledAmount(invoice.amount)!.scaled),
  );

  if (grandTotalPending === null) {
    warnings.push(
      makeParseWarning(
        -1,
        "GRAND_TOTAL_ROW_NOT_DETECTED",
        "Parser could not identify a grand total row in the sheet. The file may be truncated or the format has changed.",
        {
          sum_of_invoice_pending: scaledToDecimalString(okInvoicesSum),
        },
      ),
    );
  } else {
    const partySubtotalsTotal = addScaled(
      [...partySubtotals.values()].filter(
        (total): total is bigint => total !== null,
      ),
    );
    const gtDelta =
      grandTotalPending > partySubtotalsTotal
        ? grandTotalPending - partySubtotalsTotal
        : partySubtotalsTotal - grandTotalPending;
    if (gtDelta > AMOUNT_SCALE_FACTOR * TOLERANCE) {
      warnings.push(
        makeParseWarning(
          grandTotalRowIdx ?? -1,
          "GRAND_TOTAL_MISMATCH",
          `Sum of party sub-totals (${scaledToDecimalString(
            partySubtotalsTotal,
          )}) differs from grand total (${scaledToDecimalString(grandTotalPending)}) by ${amountDeltaString(
            gtDelta,
          )} (> ₹1 tolerance)`,
          {
            sum_of_party_subtotals: scaledToDecimalString(partySubtotalsTotal),
            grand_total: scaledToDecimalString(grandTotalPending),
            delta: amountDeltaString(gtDelta),
          },
        ),
      );
    }

    const invoiceDelta =
      okInvoicesSum > grandTotalPending
        ? okInvoicesSum - grandTotalPending
        : grandTotalPending - okInvoicesSum;
    warnings.push(
      makeParseWarning(
        grandTotalRowIdx ?? -1,
        "UNALLOCATED_CREDITS_DELTA",
        `Sum of per-invoice pending (${scaledToDecimalString(okInvoicesSum)}) vs grand total (${scaledToDecimalString(
          grandTotalPending,
        )}): delta=${amountDeltaString(invoiceDelta)} (unallocated credits / netting)`,
        {
          sum_of_invoice_pending: scaledToDecimalString(okInvoicesSum),
          grand_total: scaledToDecimalString(grandTotalPending),
          delta: amountDeltaString(invoiceDelta),
        },
      ),
    );
  }

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

const TOLERANCE = 1n;

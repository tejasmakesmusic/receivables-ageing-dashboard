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
const COLUMNS = [
  "date",
  "ref_no",
  "party_name",
  "opening_amount",
  "pending_amount",
  "due_on",
  "overdue_days",
] as const;
const TOLERANCE = 1n;

type TallyRow = Record<(typeof COLUMNS)[number], string | null>;

const ROW_MAP = Object.freeze({
  [COLUMNS[0]]: 0,
  [COLUMNS[1]]: 1,
  [COLUMNS[2]]: 2,
  [COLUMNS[3]]: 3,
  [COLUMNS[4]]: 4,
  [COLUMNS[5]]: 5,
  [COLUMNS[6]]: 6,
}) satisfies Record<string, number>;

function normalizeRow(row: unknown[]): (unknown | null)[] {
  const normalized = row.slice(0, COLUMNS.length);
  while (normalized.length < COLUMNS.length) {
    normalized.push(null);
  }
  return normalized.map((value) => (isEmptyCell(value) ? null : value));
}

function rowToRawJson(row: (unknown | null)[]): TallyRow {
  return {
    date: stringifyCell(row[ROW_MAP.date]),
    ref_no: stringifyCell(row[ROW_MAP.ref_no]),
    party_name: stringifyCell(row[ROW_MAP.party_name]),
    opening_amount: stringifyCell(row[ROW_MAP.opening_amount]),
    pending_amount: stringifyCell(row[ROW_MAP.pending_amount]),
    due_on: stringifyCell(row[ROW_MAP.due_on]),
    overdue_days: stringifyCell(row[ROW_MAP.overdue_days]),
  };
}

function isPartyHeader(row: (unknown | null)[]): boolean {
  return (
    !isEmptyCell(row[ROW_MAP.party_name]) &&
    isEmptyCell(row[ROW_MAP.date]) &&
    isEmptyCell(row[ROW_MAP.ref_no])
  );
}

function isInvoiceRow(row: (unknown | null)[]): boolean {
  return !isEmptyCell(row[ROW_MAP.date]) && !isEmptyCell(row[ROW_MAP.ref_no]);
}

function isBlankRow(row: (unknown | null)[]): boolean {
  return COLUMNS.every((column) => isEmptyCell(row[ROW_MAP[column]]));
}

function isSubtotalOrGrandTotal(row: (unknown | null)[]): boolean {
  return (
    isEmptyCell(row[ROW_MAP.date]) &&
    isEmptyCell(row[ROW_MAP.ref_no]) &&
    isEmptyCell(row[ROW_MAP.party_name]) &&
    (!isEmptyCell(row[ROW_MAP.opening_amount]) ||
      !isEmptyCell(row[ROW_MAP.pending_amount]))
  );
}

function detectGrandTotal(
  rows: (unknown | null)[][],
): [number | null, bigint | null] {
  const subtotalRows: Array<[number, bigint]> = [];

  for (let idx = HEADER_ROWS; idx < rows.length; idx += 1) {
    const row = rows[idx];
    if (!isSubtotalOrGrandTotal(row)) {
      continue;
    }

    const pending = parseScaledAmount(row[ROW_MAP.pending_amount]);
    if (!pending) {
      continue;
    }
    subtotalRows.push([idx, pending.scaled]);
  }

  if (!subtotalRows.length) {
    return [null, null];
  }

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

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  }) as unknown[][];

  const expectedCols = COLUMNS.length;
  const maxCols = rows.reduce((acc, row) => Math.max(acc, row.length), 0);
  if (maxCols < expectedCols) {
    errors.push(
      makeParseError(
        -1,
        "UNEXPECTED_SHAPE",
        `Sheet has ${maxCols} columns; expected at least ${expectedCols}.`,
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

  const normalizedRows = rows.map((row) =>
    normalizeRow(Array.isArray(row) ? row : []),
  );

  const [grandTotalRowIdx, grandTotalPending] =
    detectGrandTotal(normalizedRows);

  const partyInvoiceSums = new Map<string, bigint>();
  const partySubtotals = new Map<string, bigint | null>();
  const partySubtotalRows = new Map<string, number>();
  const partyOrder: string[] = [];
  let currentParty: string | null = null;

  for (let rawIdx = HEADER_ROWS; rawIdx < normalizedRows.length; rawIdx += 1) {
    if (rawIdx === grandTotalRowIdx) {
      continue;
    }

    const row = normalizedRows[rawIdx];

    if (isBlankRow(row)) {
      continue;
    }

    if (isPartyHeader(row)) {
      currentParty = stringifyCell(row[ROW_MAP.party_name]);
      if (currentParty && !partyInvoiceSums.has(currentParty)) {
        partyInvoiceSums.set(currentParty, 0n);
        partyOrder.push(currentParty);
      }
      continue;
    }

    if (isSubtotalOrGrandTotal(row)) {
      if (currentParty !== null && !partySubtotals.has(currentParty)) {
        const pending = parseScaledAmount(row[ROW_MAP.pending_amount]);
        partySubtotals.set(currentParty, pending?.scaled ?? null);
        partySubtotalRows.set(currentParty, rawIdx);
      }
      continue;
    }

    if (isInvoiceRow(row)) {
      const refRaw = row[ROW_MAP.ref_no];
      const dateRaw = row[ROW_MAP.date];
      const party = currentParty ?? "";
      const pendingRaw = row[ROW_MAP.pending_amount];
      const rawJsonForRow = rowToRawJson(row);

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
      invoice_ref: null,
      invoice_date: null,
      amount: null,
      raw_row_json: rowToRawJson(row),
      xero_metadata: null,
      parse_error_reason: `Row ${rawIdx} has unexpected shape: not invoice, party header, subtotal, or blank.`,
    });
  }

  for (const party of partyOrder) {
    const partySubtotal = partySubtotals.get(party);
    if (partySubtotal === undefined || partySubtotal === null) {
      continue;
    }

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

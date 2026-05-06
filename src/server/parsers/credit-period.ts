import * as XLSX from "xlsx";

import {
  ParseErrorRow,
  ParseResult,
  ParsedCreditPeriodRow,
  ParseWarning,
  SourceHint,
  computeFileSha256,
  isEmptyCell,
  makeParseError,
} from "./common";

const SHEET_INDIA = "India";
const SHEET_UAE = "UAE";
const COL_CLIENT_NAME = "Client Name";
const COL_CREDIT_PERIOD = "Credit Period";
const COL_REASON_PREFIX = "Reason for extended Credit";

type ParsedCreditRows = ParsedCreditPeriodRow & { entity_code: "IND" | "UAE" };

interface ParsedSheetOptions {
  sheetName: string;
  entity: "IND" | "UAE";
}

function normalizeText(value: unknown): string | null {
  if (isEmptyCell(value)) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized.length ? normalized : null;
}

function parseCreditDays(value: unknown): number | null {
  if (isEmptyCell(value)) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return null;
    }
    return value >= 0 ? value : null;
  }

  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function getColumnMap(headerRow: unknown[]): Record<string, number> {
  const map: Record<string, number> = {};
  headerRow.forEach((value, idx) => {
    if (typeof value === "string" && value.trim().length) {
      map[value.trim()] = idx;
    }
  });
  return map;
}

function findReasonColumn(map: Record<string, number>): number | null {
  for (const [name, idx] of Object.entries(map)) {
    if (name.startsWith(COL_REASON_PREFIX)) {
      return idx;
    }
  }
  return null;
}

function parseCreditPeriodSheet(
  rows: unknown[][],
  options: ParsedSheetOptions,
  errors: ParseErrorRow[],
): ParsedCreditRows[] {
  const { sheetName, entity } = options;
  if (rows.length === 0) {
    return [];
  }

  const headerIdx = 0;
  const colMap = getColumnMap(rows[headerIdx] ?? []);
  const missing: string[] = [];

  if (!(COL_CLIENT_NAME in colMap)) {
    missing.push(COL_CLIENT_NAME);
  }
  if (!(COL_CREDIT_PERIOD in colMap)) {
    missing.push(COL_CREDIT_PERIOD);
  }
  let reasonCol: number | null = null;
  if (entity === "UAE") {
    reasonCol = findReasonColumn(colMap);
    if (reasonCol === null) {
      missing.push(`${COL_REASON_PREFIX}[...]`);
    }
  }

  if (missing.length > 0) {
    errors.push(
      makeParseError(
        -1,
        "MISSING_REQUIRED_COLUMN",
        `Sheet '${sheetName}': required columns absent: ${missing}`,
        {
          sheet: sheetName,
          missing,
        },
      ),
    );
    return [];
  }

  const nameCol = colMap[COL_CLIENT_NAME];
  const creditCol = colMap[COL_CREDIT_PERIOD];

  const parsedRows: ParsedCreditRows[] = [];
  const validRowsForDuplicate: Array<{ name: string; row: ParsedCreditRows }> =
    [];

  for (let rawIdx = headerIdx + 1; rawIdx < rows.length; rawIdx += 1) {
    const row = rows[rawIdx];
    if (!Array.isArray(row)) {
      continue;
    }

    const clientRaw = row[nameCol];
    const clientName = normalizeText(clientRaw);
    if (clientName === null) {
      continue;
    }

    const creditDays = parseCreditDays(row[creditCol]);
    if (creditDays === null) {
      errors.push(
        makeParseError(
          rawIdx,
          "UNPARSEABLE_CREDIT_DAYS",
          `Sheet '${sheetName}': row ${rawIdx} has unparseable credit_days value.`,
          {
            sheet: sheetName,
            value: isEmptyCell(row[creditCol]) ? null : String(row[creditCol]),
          },
        ),
      );
      continue;
    }

    const rowToAdd: ParsedCreditRows = {
      row_index: rawIdx,
      entity_code: entity,
      name: clientName,
      credit_days: creditDays,
      reason_note: null,
    };

    if (entity === "UAE" && reasonCol !== null) {
      const reasonRaw = row[reasonCol];
      const reason = normalizeText(reasonRaw);
      rowToAdd.reason_note = reason;
    }

    validRowsForDuplicate.push({ name: clientName, row: rowToAdd });
  }

  const duplicates = new Map<string, number[]>();
  for (const item of validRowsForDuplicate) {
    const existing = duplicates.get(item.name) ?? [];
    existing.push(item.row.row_index);
    duplicates.set(item.name, existing);
  }

  const duplicateEntries = [...duplicates.entries()]
    .filter(([, rowIndices]) => rowIndices.length > 1)
    .map(([name, rowIndices]) => ({ name, row_indices: rowIndices }));

  if (duplicateEntries.length > 0) {
    errors.push(
      makeParseError(
        -1,
        "DUPLICATE_CLIENT",
        `Duplicate client names in ${entity} sheet: ${duplicateEntries.length} name(s) appear more than once. Fix duplicates before re-uploading.`,
        {
          entity,
          duplicates: duplicateEntries,
        },
      ),
    );
    return [];
  }

  parsedRows.push(...validRowsForDuplicate.map((item) => item.row));
  return parsedRows;
}

export function parseCreditPeriodMaster(
  fileBytes: ArrayBuffer | Uint8Array,
): ParseResult {
  const fileSha = computeFileSha256(fileBytes);
  const resultSourceHint: SourceHint = "CREDIT_PERIOD";
  const creditPeriods: ParsedCreditPeriodRow[] = [];
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
      invoices: [],
      credit_periods: [],
      errors,
      warnings,
      as_of_date: null,
      file_sha256: fileSha,
      source_hint: resultSourceHint,
      is_valid: errors.length === 0,
    };
  }

  const indiaSheet = workbook.Sheets[SHEET_INDIA];
  const uaeSheet = workbook.Sheets[SHEET_UAE];

  const missing: string[] = [];
  if (!indiaSheet) {
    missing.push(SHEET_INDIA);
  }
  if (!uaeSheet) {
    missing.push(SHEET_UAE);
  }

  if (missing.length > 0) {
    errors.push(
      makeParseError(
        -1,
        "MISSING_SHEET",
        `Required sheet(s) absent from workbook: ${missing.join(", ")}.`,
        { missing },
      ),
    );
  }

  if (indiaSheet) {
    const indiaRows = XLSX.utils.sheet_to_json<unknown[]>(indiaSheet, {
      header: 1,
      raw: true,
      blankrows: true,
      defval: null,
    }) as unknown[][];
    const indiaRowsParsed = parseCreditPeriodSheet(
      indiaRows,
      { sheetName: SHEET_INDIA, entity: "IND" },
      errors,
    );
    creditPeriods.push(...indiaRowsParsed);
  }

  if (uaeSheet) {
    const uaeRows = XLSX.utils.sheet_to_json<unknown[]>(uaeSheet, {
      header: 1,
      raw: true,
      blankrows: true,
      defval: null,
    }) as unknown[][];
    const uaeRowsParsed = parseCreditPeriodSheet(
      uaeRows,
      { sheetName: SHEET_UAE, entity: "UAE" },
      errors,
    );
    creditPeriods.push(...uaeRowsParsed);
  }

  return {
    invoices: [],
    credit_periods: creditPeriods,
    errors,
    warnings,
    as_of_date: null,
    file_sha256: fileSha,
    source_hint: resultSourceHint,
    is_valid: errors.length === 0,
  };
}

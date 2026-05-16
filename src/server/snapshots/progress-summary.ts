export type SnapshotProgressParseSummary = {
  totalRows: number;
  okRows: number;
  parseErrorRows: number;
  warningCount: number;
  fileErrorCount: number;
};

type SummaryInput = {
  parseResult: unknown;
  stagingOverrides?: unknown;
  warningsAcknowledged?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function arrayFromJson(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function warningCode(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.code === "string") return value.code;
  return null;
}

function rowIndexKey(row: unknown): string | null {
  if (!isRecord(row)) return null;
  if (typeof row.row_index !== "number" && typeof row.row_index !== "string") {
    return null;
  }
  return String(row.row_index);
}

function isDismissedByRow(row: unknown): boolean {
  if (!isRecord(row)) return false;
  if (row.dismissed === true) return true;
  return isRecord(row.analyst_overrides) && row.analyst_overrides.dismissed === true;
}

function dismissedRowKeys(value: unknown): Set<string> {
  return new Set(
    arrayFromJson(value)
      .filter(isDismissedByRow)
      .map(rowIndexKey)
      .filter((key): key is string => key !== null),
  );
}

export function summarizeSnapshotProgressParse({
  parseResult,
  stagingOverrides,
  warningsAcknowledged,
}: SummaryInput): SnapshotProgressParseSummary {
  if (!isRecord(parseResult)) {
    return {
      totalRows: 0,
      okRows: 0,
      parseErrorRows: 0,
      warningCount: 0,
      fileErrorCount: 0,
    };
  }

  const invoices = arrayFromJson(parseResult.invoices);
  const creditPeriods = arrayFromJson(parseResult.credit_periods);
  const dismissed = dismissedRowKeys(stagingOverrides);
  const acknowledgedWarnings = new Set(
    arrayFromJson(warningsAcknowledged)
      .map(warningCode)
      .filter((code): code is string => code !== null),
  );

  const parseErrorRows = invoices.filter((row) => {
    if (!isRecord(row) || row.status !== "PARSE_ERROR") return false;
    const key = rowIndexKey(row);
    return !isDismissedByRow(row) && (key === null || !dismissed.has(key));
  }).length;
  const okInvoiceRows = invoices.filter(
    (row) => isRecord(row) && row.status !== "PARSE_ERROR",
  ).length;
  const warningCount = arrayFromJson(parseResult.warnings)
    .map(warningCode)
    .filter((code): code is string => code !== null)
    .filter((code) => !acknowledgedWarnings.has(code)).length;

  return {
    totalRows: invoices.length + creditPeriods.length,
    okRows: okInvoiceRows + creditPeriods.length,
    parseErrorRows,
    warningCount,
    fileErrorCount: arrayFromJson(parseResult.errors).length,
  };
}

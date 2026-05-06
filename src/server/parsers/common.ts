import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

import type { WorkSheet } from "xlsx";

export type ParseStatus = "OK" | "PARSE_ERROR";

export type SourceHint = "TALLY" | "XERO" | "CREDIT_PERIOD";

export type EntityCode = "IND" | "UAE";

export interface ParsedInvoiceRow {
  row_index: number;
  status: ParseStatus;
  source_currency: "INR" | "AED";
  party_name_raw: string;
  invoice_ref: string | null;
  invoice_date: Date | null;
  amount: string | null;
  raw_row_json: Record<string, string | null>;
  xero_metadata?: ParsedXeroMetadata | null;
  parse_error_reason: string | null;
}

export interface ParsedXeroMetadata {
  invoice_seen: string | null;
  invoice_sent: string | null;
  project_id: string | null;
  service_month: string | null;
  primary_person: string | null;
  email: string | null;
}

export interface ParsedCreditPeriodRow {
  row_index: number;
  entity_code: EntityCode;
  name: string;
  credit_days: number;
  reason_note: string | null;
}

export interface ParseWarning {
  row_index: number;
  code: string;
  message: string;
  detail?: Record<string, unknown>;
}

export type ParseErrorRow = ParseWarning;

export interface ParseResult {
  invoices: ParsedInvoiceRow[];
  credit_periods: ParsedCreditPeriodRow[];
  errors: ParseErrorRow[];
  warnings: ParseWarning[];
  as_of_date: Date | null;
  file_sha256: string;
  source_hint: SourceHint;
  is_valid: boolean;
}

export interface MonetaryValue {
  text: string;
  scaled: bigint;
}

export interface XlsxRowsResult<T = unknown[]> {
  worksheet: WorkSheet;
  rows: T[];
}

const AMOUNT_SCALE = 6n;
export const AMOUNT_SCALE_FACTOR = 10n ** AMOUNT_SCALE;

export function computeFileSha256(fileBytes: ArrayBuffer | Uint8Array): string {
  const buffer =
    fileBytes instanceof Uint8Array
      ? Buffer.from(fileBytes)
      : Buffer.from(new Uint8Array(fileBytes));
  return createHash("sha256").update(buffer).digest("hex");
}

export function isEmptyCell(value: unknown): boolean {
  if (value == null) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isNaN(value);
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime());
  }

  return false;
}

export function stringifyCell(value: unknown): string | null {
  if (isEmptyCell(value)) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

export function parseDateCell(value: unknown): Date {
  if (isEmptyCell(value)) {
    throw new Error("empty date value");
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error(`Cannot parse date value ${String(value)}`);
    }
    return new Date(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = parseExcelDateSerial(value);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Cannot parse excel serial date ${value}`);
    }
    return parsed;
  }

  if (typeof value === "string") {
    const candidate = value.trim();
    if (candidate.length === 0) {
      throw new Error("empty date value");
    }
    const parsed = new Date(candidate);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`Cannot parse date value ${value}`);
    }
    return new Date(
      Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
    );
  }

  throw new Error(`Cannot parse date value ${String(value)}`);
}

function parseExcelDateSerial(value: number): Date {
  const ssf = (
    XLSX as {
      SSF?: {
        parse_date_code?: (n: number) => {
          y: number;
          m: number;
          d: number;
          H?: number;
          M?: number;
          S?: number;
        } | null;
      };
    }
  ).SSF;
  if (typeof ssf?.parse_date_code === "function") {
    const parsed = ssf.parse_date_code(value);
    if (parsed) {
      return new Date(
        Date.UTC(
          parsed.y,
          parsed.m - 1,
          parsed.d,
          parsed.H ?? 0,
          parsed.M ?? 0,
          parsed.S ?? 0,
        ),
      );
    }
  }

  const serialBase = Date.UTC(1899, 11, 30);
  return new Date(serialBase + Math.round(value * 86400000));
}

export function parseScaledAmount(value: unknown): MonetaryValue | null {
  if (isEmptyCell(value)) {
    return null;
  }

  let normalized: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return null;
    }
    normalized = String(value);
  } else {
    normalized = String(value).trim();
  }

  if (!normalized.length) {
    return null;
  }

  const cleaned = normalized.replace(/,/g, "");
  const match = /^([+-])?(\d+(?:\.\d+)?|\.\d+)$/.exec(cleaned);
  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1n : 1n;
  const withoutSign = cleaned.replace(/^[+-]/, "");

  const [whole, fraction = ""] = withoutSign.split(".");
  const safeWhole = whole.length > 0 ? whole : "0";
  const fractionDigits = fraction
    .slice(0, Number(AMOUNT_SCALE))
    .padEnd(Number(AMOUNT_SCALE), "0");

  if (!/^\d+$/.test(safeWhole) || !/^\d*$/.test(fractionDigits)) {
    return null;
  }

  const scaled =
    BigInt(safeWhole) * AMOUNT_SCALE_FACTOR + BigInt(fractionDigits || "0");
  return {
    text: cleaned,
    scaled: sign * scaled,
  };
}

export function addScaled(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const value of values) {
    total += value;
  }
  return total;
}

export function scaledToDecimalString(scaled: bigint): string {
  const isNegative = scaled < 0n;
  const absolute = isNegative ? -scaled : scaled;
  const integerPart = absolute / AMOUNT_SCALE_FACTOR;
  const fractionalPart = (absolute % AMOUNT_SCALE_FACTOR)
    .toString()
    .padStart(Number(AMOUNT_SCALE), "0");
  const trimmed = fractionalPart.replace(/0+$/, "");

  const base = `${integerPart.toString()}${trimmed.length ? `.${trimmed}` : ""}`;
  return isNegative ? `-${base}` : base;
}

export function makeParseError(
  rowIndex: number,
  code: string,
  message: string,
  detail?: ParseWarning["detail"],
): ParseErrorRow {
  return {
    row_index: rowIndex,
    code,
    message,
    detail,
  };
}

export function makeParseWarning(
  rowIndex: number,
  code: string,
  message: string,
  detail?: ParseWarning["detail"],
): ParseWarning {
  return {
    row_index: rowIndex,
    code,
    message,
    detail,
  };
}

export function makeParseResult(params: {
  invoices?: ParsedInvoiceRow[];
  credit_periods?: ParsedCreditPeriodRow[];
  errors?: ParseErrorRow[];
  warnings?: ParseWarning[];
  as_of_date?: Date | null;
  file_sha256: string;
  source_hint: SourceHint;
}): ParseResult {
  const invoices = params.invoices ?? [];
  const creditPeriods = params.credit_periods ?? [];
  const errors = params.errors ?? [];
  const warnings = params.warnings ?? [];

  return {
    invoices,
    credit_periods: creditPeriods,
    errors,
    warnings,
    as_of_date: params.as_of_date ?? null,
    file_sha256: params.file_sha256,
    source_hint: params.source_hint,
    is_valid: errors.length === 0,
  };
}

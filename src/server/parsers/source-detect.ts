import * as XLSX from "xlsx";

import { SourceHint } from "./common";

export class AmbiguousSourceError extends Error {
  public readonly matched: SourceHint[];

  constructor(matched: SourceHint[]) {
    super(`Sheet names match multiple sources: ${matched.join(", ")}.`);
    this.name = "AmbiguousSourceError";
    this.matched = matched;
  }
}

const TALLY_SHEET = "Sundry Debtors";
const XERO_SHEET = "Aged Receivables Detail";
const INDIA_SHEET = "India";
const UAE_SHEET = "UAE";

export function detectSourceFromXlsx(
  fileBytes: ArrayBuffer | Uint8Array,
): SourceHint | null {
  const workbook = XLSX.read(fileBytes, { type: "array" });
  const sheetNames = new Set(workbook.SheetNames);
  const matches: SourceHint[] = [];

  if (sheetNames.has(TALLY_SHEET)) {
    matches.push("TALLY");
  }

  if (sheetNames.has(XERO_SHEET)) {
    matches.push("XERO");
  }

  if (sheetNames.has(INDIA_SHEET) && sheetNames.has(UAE_SHEET)) {
    matches.push("CREDIT_PERIOD");
  }

  if (matches.length > 1) {
    throw new AmbiguousSourceError(matches);
  }

  return matches[0] ?? null;
}

export function validateSourceHintAgainstFile(
  fileBytes: ArrayBuffer | Uint8Array,
  callerHint: SourceHint,
): void {
  const detected = detectSourceFromXlsx(fileBytes);

  if (detected === null) {
    return;
  }

  if (detected !== callerHint) {
    throw new Error(
      `source_hint mismatch: caller supplied ${JSON.stringify(callerHint)} but detected ${JSON.stringify(
        detected,
      )}.`,
    );
  }
}

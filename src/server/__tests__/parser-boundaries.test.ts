import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { parseCreditPeriodMaster } from "@/server/parsers/credit-period";
import { parseTallyGrpbills } from "@/server/parsers/tally";
import { parseXeroAgedReceivables } from "@/server/parsers/xero";

function workbookBytes(sheets: Record<string, unknown[][]>): Uint8Array {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

describe("parser launch-risk boundaries", () => {
  it("Tally rejects sheets with too few columns as an invalid file shape", () => {
    const result = parseTallyGrpbills(
      workbookBytes({
        "Sundry Debtors": [
          ["header"],
          ["header"],
          ["header"],
          ["header"],
          ["header"],
          ["2026-05-01", "INV-1"],
        ],
      }),
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "UNEXPECTED_SHAPE",
    );
    expect(result.invoices).toHaveLength(0);
  });

  it("Tally stages malformed invoice rows as PARSE_ERROR instead of dropping them", () => {
    const result = parseTallyGrpbills(
      workbookBytes({
        "Sundry Debtors": [
          ["header", null, null, null, null, null, null],
          ["header", null, null, null, null, null, null],
          ["header", null, null, null, null, null, null],
          ["header", null, null, null, null, null, null],
          ["header", null, null, null, null, null, null],
          [null, null, "ACME Pvt Ltd", null, null, null, null],
          ["not-a-date", "INV-001", null, "1000", "1000", null, null],
          [null, null, null, "1000", "1000", null, null],
          [null, null, null, "1000", "1000", null, null],
        ],
      }),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.is_valid).toBe(true);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({
      row_index: 6,
      status: "PARSE_ERROR",
      party_name_raw: "ACME Pvt Ltd",
      invoice_ref: null,
      invoice_date: null,
      amount: null,
    });
    expect(result.invoices[0].parse_error_reason).toMatch(/date/i);
  });

  it("Xero reports missing required headers as file-level errors", () => {
    const result = parseXeroAgedReceivables(
      workbookBytes({
        "Aged Receivables Detail": [
          [],
          [],
          ["Aged Receivables Detail as at 6 May 2026"],
          [],
          [],
          ["Contact Account Number", "Invoice Date", "Invoice Number"],
          ["ACME", "2026-05-01", "INV-1"],
        ],
      }),
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].code).toBe("MISSING_REQUIRED_COLUMN");
    expect(result.errors[0].detail).toMatchObject({ missing: ["Total"] });
  });

  it("Xero stages credit-note rows with missing invoice numbers as PARSE_ERROR", () => {
    const result = parseXeroAgedReceivables(
      workbookBytes({
        "Aged Receivables Detail": [
          [],
          [],
          ["Aged Receivables Detail as at 6 May 2026"],
          [],
          [],
          ["Contact Account Number", "Invoice Date", "Invoice Number", "Total"],
          ["ACME LLC", null, null, null],
          [null, "2026-05-01", null, "-25.00"],
          ["Total ACME LLC", null, null, "-25.00"],
          ["Total", null, null, "-25.00"],
        ],
      }),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.is_valid).toBe(true);
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({
      row_index: 7,
      status: "PARSE_ERROR",
      party_name_raw: "ACME LLC",
      invoice_ref: null,
      amount: null,
    });
    expect(result.invoices[0].parse_error_reason).toMatch(/no invoice number/i);
  });

  it("credit-period parser rejects invalid credit days and never persists UAE Amount", () => {
    const result = parseCreditPeriodMaster(
      workbookBytes({
        India: [
          ["Client Name", "Credit Period"],
          ["ACME Pvt Ltd", "thirty"],
        ],
        UAE: [
          [
            "Client Name",
            "Credit Period",
            "Amount",
            "Reason for extended Credit period",
          ],
          ["ACME LLC", 45, "999999", "Approved by finance"],
        ],
      }),
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toContain(
      "UNPARSEABLE_CREDIT_DAYS",
    );
    expect(result.credit_periods).toEqual([
      {
        row_index: 1,
        entity_code: "UAE",
        name: "ACME LLC",
        credit_days: 45,
        reason_note: "Approved by finance",
      },
    ]);
    expect(JSON.stringify(result.credit_periods)).not.toContain("999999");
  });
});

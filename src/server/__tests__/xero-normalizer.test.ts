import { describe, expect, it } from "vitest";
import { normalizeXeroInvoicesToParseResult } from "@/server/xero/normalizer";

describe("xero normalizer", () => {
  it("normalizes open AED sales invoices into parser rows", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-1",
          InvoiceNumber: "INV-001",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: {
            ContactID: "contact-1",
            Name: "Acme LLC",
            EmailAddress: "ar@acme.example",
          },
          DateString: "2026-05-01T00:00:00",
          DueDateString: "2026-05-31T00:00:00",
          AmountDue: 1250.5,
          Total: 1250.5,
          CurrencyCode: "AED",
          Reference: "Project Alpha",
          SentToContact: true,
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "a".repeat(64),
    });

    expect(result.source_hint).toBe("XERO");
    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0]).toMatchObject({
      status: "OK",
      party_name_raw: "Acme LLC",
      xero_contact_id: "contact-1",
      invoice_ref: "INV-001",
      amount: "1250.50",
      source_currency: "AED",
      parse_error_reason: null,
    });
    expect(result.invoices[0].xero_metadata).toMatchObject({
      invoice_sent: "true",
      email: "ar@acme.example",
      project_id: "Project Alpha",
    });
    expect(result.errors).toHaveLength(0);
    expect(result.is_valid).toBe(true);
  });

  it("filters out voided, deleted, and zero-balance invoices before assigning row indices", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "void-1",
          InvoiceNumber: "INV-V",
          Type: "ACCREC",
          Status: "VOIDED",
          Contact: { ContactID: "c", Name: "Voided" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 100,
          CurrencyCode: "AED",
        },
        {
          InvoiceID: "paid-1",
          InvoiceNumber: "INV-P",
          Type: "ACCREC",
          Status: "PAID",
          Contact: { ContactID: "c", Name: "Paid" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 0,
          CurrencyCode: "AED",
        },
        {
          InvoiceID: "ap-1",
          InvoiceNumber: "BILL-1",
          Type: "ACCPAY",
          Status: "AUTHORISED",
          Contact: { ContactID: "c", Name: "Supplier" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 100,
          CurrencyCode: "AED",
        },
        {
          InvoiceID: "open-1",
          InvoiceNumber: "INV-OPEN",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "c", Name: "Open" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 100,
          CurrencyCode: "AED",
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "f".repeat(64),
    });

    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].row_index).toBe(1);
    expect(result.invoices[0].invoice_ref).toBe("INV-OPEN");
  });

  it("stages missing required fields as PARSE_ERROR", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-2",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "contact-2" },
          AmountDue: 25,
          CurrencyCode: "AED",
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "b".repeat(64),
    });

    expect(result.is_valid).toBe(false);
    expect(result.invoices[0]).toMatchObject({
      status: "PARSE_ERROR",
      parse_error_reason:
        "Missing required Xero fields: Contact.Name, InvoiceNumber, Date",
    });
    expect(result.errors[0]).toMatchObject({
      code: "XERO_API_ROW_PARSE_ERROR",
    });
  });

  it("keeps unsupported currencies visible as PARSE_ERROR", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-3",
          InvoiceNumber: "INV-003",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "contact-3", Name: "USD Customer" },
          DateString: "2026-05-01T00:00:00",
          AmountDue: 100,
          CurrencyCode: "USD",
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "c".repeat(64),
    });

    expect(result.invoices[0]).toMatchObject({
      status: "PARSE_ERROR",
      parse_error_reason: "Unsupported Xero invoice currency: USD",
    });
  });

  it("does not copy Xero due date into ageing fields", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [
        {
          InvoiceID: "inv-4",
          InvoiceNumber: "INV-004",
          Type: "ACCREC",
          Status: "AUTHORISED",
          Contact: { ContactID: "contact-4", Name: "Due Date Customer" },
          DateString: "2026-05-01T00:00:00",
          DueDateString: "2026-05-02T00:00:00",
          AmountDue: 100,
          CurrencyCode: "AED",
        },
      ],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "d".repeat(64),
    });

    expect(result.invoices[0].raw_row_json).toMatchObject({
      DueDateString: "2026-05-02T00:00:00",
    });
    expect(result.invoices[0]).not.toHaveProperty("due_date");
  });

  it("emits an XERO_API_SOURCE warning that carries source_origin", () => {
    const result = normalizeXeroInvoicesToParseResult({
      invoices: [],
      pulledAt: new Date("2026-05-16T00:00:00.000Z"),
      fileSha256: "e".repeat(64),
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatchObject({
      code: "XERO_API_SOURCE",
      detail: { source_origin: "XERO_API" },
    });
  });
});

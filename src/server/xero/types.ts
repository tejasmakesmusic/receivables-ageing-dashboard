/**
 * Boundary types for Xero API responses we depend on.
 * Intentionally narrow — only the fields the normalizer or connector reads.
 * Everything is optional because Xero's responses are not contract-stable
 * and we want missing fields to flow as PARSE_ERROR rather than crash the
 * connector.
 */

export interface XeroTokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type: "Bearer" | string;
}

export interface XeroTenant {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantType: string;
  createdDateUtc: string;
  updatedDateUtc: string;
}

export interface XeroContact {
  ContactID?: string;
  Name?: string;
  ContactNumber?: string;
  EmailAddress?: string;
}

export interface XeroInvoice {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type?: string;
  Status?: string;
  Contact?: XeroContact;
  Date?: string;
  DateString?: string;
  DueDate?: string;
  DueDateString?: string;
  AmountDue?: number;
  Total?: number;
  CurrencyCode?: string;
  Reference?: string;
  SentToContact?: boolean;
  UpdatedDateUTC?: string;
}

export interface XeroInvoicesResponse {
  Invoices?: XeroInvoice[];
}

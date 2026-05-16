import type {
  XeroInvoice,
  XeroInvoicesResponse,
  XeroTenant,
  XeroTokenSet,
} from "@/server/xero/types";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const ACCOUNTING_API_URL = "https://api.xero.com/api.xro/2.0";

// Xero pages /Invoices in batches of up to 100. We cap pagination to keep
// a single pull bounded — UAE today has well under 5k open invoices, so
// 100 pages (= 10k rows) is a generous ceiling that still prevents runaway
// loops if Xero ever returns a stuck `length === 100` response.
const MAX_INVOICE_PAGES = 100;

// One bounded retry after a 429. We sleep for the retry-after window then
// give up — the caller marks the sync run FAILED and the analyst can retry.
const MAX_RATE_LIMIT_RETRY_SECONDS = 60;

export class XeroApiError extends Error {
  readonly code = "xero_api_error";
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(params: {
    status: number;
    message: string;
    retryAfterSeconds?: number | null;
  }) {
    super(params.message);
    this.name = "XeroApiError";
    this.status = params.status;
    this.retryAfterSeconds = params.retryAfterSeconds ?? null;
  }
}

export function buildXeroAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  scopes: string;
  state: string;
}): URL {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes);
  url.searchParams.set("state", input.state);
  return url;
}

function basicAuth(clientId: string, clientSecret: string): string {
  return Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64");
}

async function postTokenRequest(
  body: URLSearchParams,
  clientId: string,
  clientSecret: string,
): Promise<XeroTokenSet> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth(clientId, clientSecret)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new XeroApiError({
      status: response.status,
      message: await response.text(),
    });
  }

  return (await response.json()) as XeroTokenSet;
}

export async function exchangeCodeForTokens(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<XeroTokenSet> {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
    input.clientId,
    input.clientSecret,
  );
}

export async function refreshAccessToken(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<XeroTokenSet> {
  return postTokenRequest(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }),
    input.clientId,
    input.clientSecret,
  );
}

async function parseXeroResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfterHeader
      ? Number(retryAfterHeader)
      : null;
    throw new XeroApiError({
      status: response.status,
      message: await response.text(),
      retryAfterSeconds:
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : null,
    });
  }
  return (await response.json()) as T;
}

export async function listXeroTenants(
  accessToken: string,
): Promise<XeroTenant[]> {
  const response = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseXeroResponse<XeroTenant[]>(response);
}

export async function fetchXeroJson<T = unknown>(input: {
  accessToken: string;
  tenantId: string;
  path: string;
  searchParams?: Record<string, string>;
}): Promise<T> {
  const url = new URL(`${ACCOUNTING_API_URL}${input.path}`);
  for (const [key, value] of Object.entries(input.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "xero-tenant-id": input.tenantId,
      Accept: "application/json",
    },
  });
  return parseXeroResponse<T>(response);
}

// Used by Task 7 to bound the pagination sleep on 429.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pull every page of open ACCREC invoices for a tenant. Xero returns up
 * to 100 invoices per page; we keep paging until a short page or the
 * MAX_INVOICE_PAGES guard fires. On a single 429 we wait the retry-after
 * window (capped at MAX_RATE_LIMIT_RETRY_SECONDS) and retry once; a
 * second 429 bubbles up and the caller marks the sync run FAILED.
 */
export async function fetchOpenReceivableInvoices(input: {
  accessToken: string;
  tenantId: string;
}): Promise<{ invoices: XeroInvoice[]; pagesFetched: number }> {
  const invoices: XeroInvoice[] = [];
  let page = 1;
  let rateLimitedOnce = false;

  while (page <= MAX_INVOICE_PAGES) {
    try {
      const response = await fetchXeroJson<XeroInvoicesResponse>({
        accessToken: input.accessToken,
        tenantId: input.tenantId,
        path: "/Invoices",
        searchParams: {
          page: String(page),
          where: 'Type=="ACCREC"&&AmountDue>0',
          order: "Date ASC",
        },
      });
      const batch = response.Invoices ?? [];
      invoices.push(...batch);
      if (batch.length < 100) {
        return { invoices, pagesFetched: page };
      }
      page += 1;
    } catch (error) {
      if (
        error instanceof XeroApiError &&
        error.status === 429 &&
        !rateLimitedOnce
      ) {
        rateLimitedOnce = true;
        const waitSeconds = Math.min(
          error.retryAfterSeconds ?? 30,
          MAX_RATE_LIMIT_RETRY_SECONDS,
        );
        await sleep(waitSeconds * 1000);
        continue;
      }
      throw error;
    }
  }

  return { invoices, pagesFetched: MAX_INVOICE_PAGES };
}

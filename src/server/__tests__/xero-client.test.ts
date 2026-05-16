import { afterEach, describe, expect, it, vi } from "vitest";
import {
  XeroApiError,
  buildXeroAuthorizationUrl,
  exchangeCodeForTokens,
  fetchOpenReceivableInvoices,
  fetchXeroJson,
  refreshAccessToken,
} from "@/server/xero/client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("xero client", () => {
  it("builds an OAuth authorization URL with read-only scopes", () => {
    const url = buildXeroAuthorizationUrl({
      clientId: "client-id",
      redirectUri: "http://localhost:3000/api/admin/xero/callback",
      scopes: "openid profile email offline_access accounting.transactions.read",
      state: "state-token",
    });

    expect(url.origin).toBe("https://login.xero.com");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("scope")).toContain("offline_access");
  });

  it("exchanges an authorization code for tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "access",
            refresh_token: "refresh",
            expires_in: 1800,
            token_type: "Bearer",
          }),
      }),
    );

    const tokens = await exchangeCodeForTokens({
      code: "abc",
      clientId: "client",
      clientSecret: "secret",
      redirectUri: "http://localhost/callback",
    });

    expect(tokens.refresh_token).toBe("refresh");
  });

  it("refreshes an access token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 1800,
            token_type: "Bearer",
          }),
      }),
    );

    const tokens = await refreshAccessToken({
      refreshToken: "old-refresh",
      clientId: "client",
      clientSecret: "secret",
    });

    expect(tokens.access_token).toBe("new-access");
  });

  it("throws structured errors for failed Xero responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "60" }),
        text: () => Promise.resolve("rate limited"),
      }),
    );

    await expect(
      fetchXeroJson({
        accessToken: "access",
        tenantId: "tenant",
        path: "/Invoices",
      }),
    ).rejects.toMatchObject({
      code: "xero_api_error",
      status: 429,
      retryAfterSeconds: 60,
    });
  });

  it("paginates invoice fetches until a short page", async () => {
    const fullPage = Array.from({ length: 100 }, (_, idx) => ({
      InvoiceID: `inv-${idx}`,
      Type: "ACCREC",
    }));
    const shortPage = [{ InvoiceID: "inv-tail", Type: "ACCREC" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ Invoices: fullPage }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ Invoices: shortPage }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchOpenReceivableInvoices({
      accessToken: "access",
      tenantId: "tenant",
    });

    expect(result.pagesFetched).toBe(2);
    expect(result.invoices).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries once on 429 then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ Invoices: [] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchOpenReceivableInvoices({
      accessToken: "access",
      tenantId: "tenant",
    });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.invoices).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after a second 429", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "1" }),
        text: () => Promise.resolve("rate limited again"),
      });
    vi.stubGlobal("fetch", fetchMock);

    const promise = fetchOpenReceivableInvoices({
      accessToken: "access",
      tenantId: "tenant",
    });
    // Catch the rejection so the unhandled rejection doesn't fail vitest.
    const captured = promise.catch((err: unknown) => err);
    await vi.advanceTimersByTimeAsync(1000);
    const error = await captured;

    expect(error).toBeInstanceOf(XeroApiError);
    expect((error as XeroApiError).status).toBe(429);
  });
});

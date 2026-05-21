import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockExchangeCodeForUser = vi.hoisted(() => vi.fn());
const mockParseStateToken = vi.hoisted(() => vi.fn());

vi.mock("@/lib/google-oauth", () => ({
  exchangeCodeForUser: mockExchangeCodeForUser,
  parseStateToken: mockParseStateToken,
  generateStateToken: vi.fn(),
  generateAuthUrl: vi.fn(),
}));

const mockGetOrCreateGoogleUser = vi.hoisted(() => vi.fn());
const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());

vi.mock("@/server/core/auth", () => ({
  getOrCreateGoogleUser: mockGetOrCreateGoogleUser,
  setAuthSessionCookie: mockSetAuthSessionCookie,
  isStubProviderEnabled: vi.fn().mockReturnValue(false),
}));

const mockCreateAuditLog = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/audit", () => ({
  createAuditLog: mockCreateAuditLog,
}));

import { GET } from "@/app/auth/google/callback/route";

const BASE_USER = {
  id: "user-uuid",
  email: "alice@emb.global",
  name: "Alice",
  role: role_enum.ANALYST,
  entity_id_scope: null,
  is_active: true,
  last_login_at: null,
  google_sub: "g-sub-1",
};

function makeRequest(params: Record<string, string>, stateCookie?: string) {
  const url = new URL("https://receivablesageingdashboard.vercel.app/auth/google/callback");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const req = new NextRequest(url);
  if (stateCookie) {
    req.cookies.set("google_oauth_state", stateCookie);
  }
  return req;
}

describe("GET /auth/google/callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to login when Google returns an error param", async () => {
    const req = makeRequest({ error: "access_denied" }, "nonce-abc");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("redirects to login when code or state is missing", async () => {
    const req = makeRequest({ code: "abc" });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("redirects to login when state cookie is missing", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    const req = makeRequest({ code: "abc", state: "encoded-state" });
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("redirects to login when nonce mismatch", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "DIFFERENT", next: "/dashboard" });
    const req = makeRequest({ code: "abc", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/login");
  });

  it("redirects to dashboard for an existing non-PENDING user", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockResolvedValue({
      sub: "g-sub-1", email: "alice@emb.global", name: "Alice",
    });
    mockGetOrCreateGoogleUser.mockResolvedValue({
      user: BASE_USER,
      isNew: false,
    });

    const req = makeRequest({ code: "valid-code", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("redirects to /auth/pending for PENDING role", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockResolvedValue({
      sub: "g-sub-new", email: "new@emb.global", name: "New",
    });
    mockGetOrCreateGoogleUser.mockResolvedValue({
      user: { ...BASE_USER, role: role_enum.PENDING },
      isNew: true,
    });

    const req = makeRequest({ code: "valid-code", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/pending");
  });

  it("redirects to login with error param when exchange throws", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockRejectedValue(new Error("token exchange failed"));

    const req = makeRequest({ code: "bad-code", state: "encoded-state" }, "nonce-abc");
    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=oauth_failed");
  });

  it("clears the state cookie on success", async () => {
    mockParseStateToken.mockReturnValue({ nonce: "nonce-abc", next: "/dashboard" });
    mockExchangeCodeForUser.mockResolvedValue({
      sub: "g-sub-1", email: "alice@emb.global", name: "Alice",
    });
    mockGetOrCreateGoogleUser.mockResolvedValue({ user: BASE_USER, isNew: false });

    const req = makeRequest({ code: "code", state: "state" }, "nonce-abc");
    const res = await GET(req);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("google_oauth_state=");
    expect(setCookie).toContain("Max-Age=0");
  });
});

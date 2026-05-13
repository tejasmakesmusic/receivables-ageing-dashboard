import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockVerifyEmailToken = vi.hoisted(() => vi.fn());
const mockResendVerificationEmail = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  verifyEmailToken: mockVerifyEmailToken,
  resendVerificationEmail: mockResendVerificationEmail,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { GET } from "@/app/api/auth/verify-email/confirm/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: "PENDING",
  is_active: true,
  email_verified: true,
};

function makeRequest(token?: string) {
  const url = new URL("https://example.com/api/auth/verify-email/confirm");
  if (token) url.searchParams.set("token", token);
  return new NextRequest(url);
}

describe("GET /api/auth/verify-email/confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to /auth/pending on valid token and sets session cookie", async () => {
    mockVerifyEmailToken.mockResolvedValue(BASE_USER);
    const res = await GET(makeRequest("valid-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/pending");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("redirects to /auth/login?error=token_invalid when token is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=token_invalid");
    expect(mockVerifyEmailToken).not.toHaveBeenCalled();
  });

  it("redirects to /auth/login?error=token_expired when token not found or expired", async () => {
    mockVerifyEmailToken.mockResolvedValue(null);
    const res = await GET(makeRequest("bad-or-expired-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=token_expired");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });
});

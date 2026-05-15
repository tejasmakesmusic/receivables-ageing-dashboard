import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockVerifyOtpToken = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  verifyOtpToken: mockVerifyOtpToken,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { GET } from "@/app/api/auth/otp/confirm/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: role_enum.ANALYST,
  is_active: true,
};

function makeRequest(token?: string) {
  const url = new URL("https://example.com/api/auth/otp/confirm");
  if (token) url.searchParams.set("token", token);
  return new NextRequest(url);
}

describe("GET /api/auth/otp/confirm", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to /dashboard and sets session cookie on valid token", async () => {
    mockVerifyOtpToken.mockResolvedValue(BASE_USER);
    const res = await GET(makeRequest("valid-otp-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("redirects to /auth/login?error=token_invalid when token is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=token_invalid");
    expect(mockVerifyOtpToken).not.toHaveBeenCalled();
  });

  it("redirects to /auth/login?error=token_expired when token not found or expired", async () => {
    mockVerifyOtpToken.mockResolvedValue(null);
    const res = await GET(makeRequest("bad-or-expired"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=token_expired");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("redirects PENDING role to /auth/pending", async () => {
    mockVerifyOtpToken.mockResolvedValue({ ...BASE_USER, role: role_enum.PENDING });
    const res = await GET(makeRequest("valid-token"));
    expect(res.headers.get("location")).toContain("/auth/pending");
  });

  it("redirects to /auth/login?error=server_error on unexpected error", async () => {
    mockVerifyOtpToken.mockRejectedValue(new Error("db_error"));
    const res = await GET(makeRequest("some-token"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("error=server_error");
  });
});

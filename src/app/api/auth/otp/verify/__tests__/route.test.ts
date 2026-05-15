import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockVerifyOtpCode = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  verifyOtpCode: mockVerifyOtpCode,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { POST } from "@/app/api/auth/otp/verify/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: role_enum.ANALYST,
  is_active: true,
  email_verified: true,
};

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/otp/verify", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with redirectTo and sets session cookie on valid code", async () => {
    mockVerifyOtpCode.mockResolvedValue(BASE_USER);
    const res = await POST(makeRequest({ email: "alice@example.com", code: "123456" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.redirectTo).toBe("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("returns 400 with invalid_otp on wrong or expired code", async () => {
    mockVerifyOtpCode.mockResolvedValue(null);
    const res = await POST(makeRequest({ email: "alice@example.com", code: "000000" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_otp");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 422 for missing fields", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(422);
  });

  it("returns 422 for non-numeric code", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com", code: "abcdef" }));
    expect(res.status).toBe(422);
    expect(mockVerifyOtpCode).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected error from verifyOtpCode", async () => {
    mockVerifyOtpCode.mockRejectedValue(new Error("db_error"));
    const res = await POST(makeRequest({ email: "alice@example.com", code: "123456" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("server_error");
  });

  it("redirects PENDING role to /auth/pending", async () => {
    mockVerifyOtpCode.mockResolvedValue({ ...BASE_USER, role: role_enum.PENDING });
    const res = await POST(makeRequest({ email: "alice@example.com", code: "123456" }));
    const body = await res.json();
    expect(body.redirectTo).toBe("/auth/pending");
  });
});

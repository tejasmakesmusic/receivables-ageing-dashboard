import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockVerifyEmailPassword = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  verifyEmailPassword: mockVerifyEmailPassword,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { POST } from "@/app/api/auth/login/password/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: role_enum.ANALYST,
  is_active: true,
  email_verified: true,
};

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/login/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/login/password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 and sets session cookie on valid credentials", async () => {
    mockVerifyEmailPassword.mockResolvedValue(BASE_USER);
    const res = await POST(makeRequest({ email: "alice@example.com", password: "pass1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("returns 401 when verifyEmailPassword returns null (wrong password or no user)", async () => {
    mockVerifyEmailPassword.mockResolvedValue(null);
    const res = await POST(makeRequest({ email: "alice@example.com", password: "wrong" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("invalid_credentials");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 403 with use_google when account uses Google OAuth", async () => {
    mockVerifyEmailPassword.mockRejectedValue(new Error("use_google"));
    const res = await POST(makeRequest({ email: "google@example.com", password: "anything" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("use_google");
  });

  it("returns 403 with email_not_verified when email not verified", async () => {
    mockVerifyEmailPassword.mockRejectedValue(new Error("email_not_verified"));
    const res = await POST(makeRequest({ email: "unverified@example.com", password: "pass1234" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("email_not_verified");
  });

  it("returns 422 for missing fields", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(422);
  });

  it("redirects PENDING role to /auth/pending", async () => {
    mockVerifyEmailPassword.mockResolvedValue({ ...BASE_USER, role: role_enum.PENDING });
    const res = await POST(makeRequest({ email: "alice@example.com", password: "pass1234" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redirectTo).toBe("/auth/pending");
  });
});

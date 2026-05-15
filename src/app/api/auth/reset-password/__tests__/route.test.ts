import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { role_enum } from "@/generated/prisma/enums";

const mockResetPassword = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  resetPassword: mockResetPassword,
}));

const mockSetAuthSessionCookie = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/auth", () => ({
  setAuthSessionCookie: mockSetAuthSessionCookie,
}));

import { POST } from "@/app/api/auth/reset-password/route";

const BASE_USER = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice",
  role: role_enum.ANALYST,
  is_active: true,
};

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with redirectTo and sets session cookie on valid token + password", async () => {
    mockResetPassword.mockResolvedValue(BASE_USER);
    const res = await POST(makeRequest({ token: "valid-token", password: "newpass123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.redirectTo).toBe("/dashboard");
    expect(mockSetAuthSessionCookie).toHaveBeenCalledWith(res, BASE_USER.id);
  });

  it("returns 400 with token_expired on invalid or expired token", async () => {
    mockResetPassword.mockResolvedValue(null);
    const res = await POST(makeRequest({ token: "bad-token", password: "newpass123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("token_expired");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 422 with password_too_short when password is under 8 chars (Zod)", async () => {
    const res = await POST(makeRequest({ token: "valid-token", password: "short" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("password_too_short");
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it("returns 422 for missing token", async () => {
    const res = await POST(makeRequest({ password: "newpass123" }));
    expect(res.status).toBe(422);
  });

  it("redirects PENDING role to /auth/pending", async () => {
    mockResetPassword.mockResolvedValue({ ...BASE_USER, role: role_enum.PENDING });
    const res = await POST(makeRequest({ token: "valid-token", password: "newpass123" }));
    const body = await res.json();
    expect(body.redirectTo).toBe("/auth/pending");
  });

  it("returns 403 account_inactive when user is_active=false", async () => {
    mockResetPassword.mockResolvedValue({ ...BASE_USER, is_active: false });
    const res = await POST(makeRequest({ token: "valid-token", password: "newpass123" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("account_inactive");
    expect(mockSetAuthSessionCookie).not.toHaveBeenCalled();
  });

  it("returns 422 password_too_short when core throws (defence-in-depth)", async () => {
    mockResetPassword.mockRejectedValue(new Error("password_too_short"));
    const res = await POST(makeRequest({ token: "valid-token", password: "newpass123" }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("password_too_short");
  });

  it("returns 500 on unexpected error", async () => {
    mockResetPassword.mockRejectedValue(new Error("db_error"));
    const res = await POST(makeRequest({ token: "valid-token", password: "newpass123" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("server_error");
  });
});

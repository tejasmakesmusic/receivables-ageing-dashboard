import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRequestPasswordReset = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  requestPasswordReset: mockRequestPasswordReset,
}));

import { POST } from "@/app/api/auth/forgot-password/route";

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/forgot-password", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 and calls requestPasswordReset on valid email", async () => {
    mockRequestPasswordReset.mockResolvedValue(true);
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockRequestPasswordReset).toHaveBeenCalledWith("alice@example.com");
  });

  it("returns 422 for invalid email format", async () => {
    const res = await POST(makeRequest({ email: "bad" }));
    expect(res.status).toBe(422);
    expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("https://example.com/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "bad json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 on unexpected error", async () => {
    mockRequestPasswordReset.mockRejectedValue(new Error("db_error"));
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("server_error");
  });
});

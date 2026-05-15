import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockRequestOtp = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  requestOtp: mockRequestOtp,
}));

import { POST } from "@/app/api/auth/otp/request/route";

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/otp/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/otp/request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 and calls requestOtp on valid email", async () => {
    mockRequestOtp.mockResolvedValue(true);
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockRequestOtp).toHaveBeenCalledWith("alice@example.com");
  });

  it("returns 422 for invalid email format", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(422);
    expect(mockRequestOtp).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const req = new NextRequest("https://example.com/api/auth/otp/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 on unexpected error from requestOtp", async () => {
    mockRequestOtp.mockRejectedValue(new Error("db_error"));
    const res = await POST(makeRequest({ email: "alice@example.com" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("server_error");
  });
});

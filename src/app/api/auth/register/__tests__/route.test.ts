import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockCreateEmailPasswordUser = vi.hoisted(() => vi.fn());
vi.mock("@/server/core/email-auth", () => ({
  createEmailPasswordUser: mockCreateEmailPasswordUser,
}));

import { POST } from "@/app/api/auth/register/route";

function makeRequest(body: unknown) {
  return new NextRequest("https://example.com/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/register", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 201 on successful registration", async () => {
    mockCreateEmailPasswordUser.mockResolvedValue({
      user: { id: "u1", email: "alice@example.com", name: "Alice" },
    });
    const res = await POST(makeRequest({
      name: "Alice",
      email: "alice@example.com",
      password: "password123",
      confirmPassword: "password123",
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("returns 422 for password shorter than 8 chars", async () => {
    const res = await POST(makeRequest({
      name: "Alice",
      email: "a@b.com",
      password: "short",
      confirmPassword: "short",
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("password_too_short");
    expect(mockCreateEmailPasswordUser).not.toHaveBeenCalled();
  });

  it("returns 422 when passwords do not match", async () => {
    const res = await POST(makeRequest({
      name: "Alice",
      email: "a@b.com",
      password: "password123",
      confirmPassword: "differentpass",
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("passwords_mismatch");
    expect(mockCreateEmailPasswordUser).not.toHaveBeenCalled();
  });

  it("returns 422 for invalid email", async () => {
    const res = await POST(makeRequest({
      name: "Alice",
      email: "not-an-email",
      password: "password123",
      confirmPassword: "password123",
    }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("invalid_email");
  });

  it("returns 409 when email is already taken", async () => {
    mockCreateEmailPasswordUser.mockRejectedValue(new Error("email_taken"));
    const res = await POST(makeRequest({
      name: "Bob",
      email: "taken@example.com",
      password: "password123",
      confirmPassword: "password123",
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("email_taken");
  });
});

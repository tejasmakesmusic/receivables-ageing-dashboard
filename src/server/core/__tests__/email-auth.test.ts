import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mock prisma ---
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockUpdateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    users: {
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      updateMany: mockUpdateMany,
    },
  }),
}));

// --- mock email ---
const mockSendEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendEmail: mockSendEmail }));

// --- mock env ---
vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "test",
    SESSION_SECRET: "test-secret-32-chars-padding-here",
    NEXTAUTH_URL: "https://example.com",
  },
}));

import {
  generateVerificationToken,
  createEmailPasswordUser,
  verifyEmailPassword,
  verifyEmailToken,
  resendVerificationEmail,
  requestOtp,
  verifyOtpCode,
  verifyOtpToken,
  requestPasswordReset,
  resetPassword,
} from "@/server/core/email-auth";

describe("generateVerificationToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateVerificationToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different token each call", () => {
    expect(generateVerificationToken()).not.toBe(generateVerificationToken());
  });
});

describe("createEmailPasswordUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a user with hashed password and returns it", async () => {
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
      role: "PENDING",
      is_active: true,
      email_verified: false,
      email_verification_token: "tok",
      email_verification_expires_at: new Date(),
    });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await createEmailPasswordUser({
      email: "alice@example.com",
      name: "Alice",
      password: "password123",
    });

    expect(result.user.email).toBe("alice@example.com");
    expect(mockCreate).toHaveBeenCalledOnce();
    const createArgs = mockCreate.mock.calls[0][0].data;
    expect(createArgs.password_hash).toBeDefined();
    expect(createArgs.password_hash).not.toBe("password123");
    expect(createArgs.email_verified).toBe(false);
    expect(createArgs.role).toBe("PENDING");
    expect(mockSendEmail).toHaveBeenCalledOnce();
  });

  it("throws email_taken when email already exists", async () => {
    mockFindUnique.mockResolvedValue({ id: "existing" });

    await expect(
      createEmailPasswordUser({ email: "taken@example.com", name: "Bob", password: "pass1234" })
    ).rejects.toThrow("email_taken");
  });
});

describe("verifyEmailPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user on correct password and verified email", async () => {
    const { hash } = await import("bcryptjs");
    const hashed = await hash("correct-pass", 1); // cost 1 for test speed
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
      email_verified: true,
      password_hash: hashed,
      last_login_at: null,
    });
    mockUpdate.mockResolvedValue({
      id: "u1",
      email: "alice@example.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
    });

    const result = await verifyEmailPassword("alice@example.com", "correct-pass");
    expect(result).not.toBeNull();
    expect(result?.email).toBe("alice@example.com");
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({ last_login_at: expect.any(Date) }),
    }));
  });

  it("returns null when user not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await verifyEmailPassword("nobody@example.com", "pass");
    expect(result).toBeNull();
  });

  it("returns null when password is wrong", async () => {
    const { hash } = await import("bcryptjs");
    const hashed = await hash("right-pass", 1);
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      password_hash: hashed,
      email_verified: true,
    });
    const result = await verifyEmailPassword("a@b.com", "wrong-pass");
    expect(result).toBeNull();
  });

  it("throws email_not_verified when email not verified", async () => {
    const { hash } = await import("bcryptjs");
    const hashed = await hash("pass", 1);
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      password_hash: hashed,
      email_verified: false,
    });
    await expect(verifyEmailPassword("a@b.com", "pass")).rejects.toThrow("email_not_verified");
  });

  it("throws use_google when password_hash is null", async () => {
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "google@b.com",
      password_hash: null,
      email_verified: true,
    });
    await expect(verifyEmailPassword("google@b.com", "anything")).rejects.toThrow("use_google");
  });
});

describe("verifyEmailToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user and sets email_verified=true on valid token", async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000);
    const userRecord = {
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "PENDING",
      is_active: true,
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    };
    // findFirst returns matching user (token + expiry check)
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "PENDING",
      email_verified: false,
      email_verification_token: "valid-token",
      email_verification_expires_at: futureDate,
    });
    // updateMany succeeds (count=1) — this is the race-safe write
    mockUpdateMany.mockResolvedValue({ count: 1 });
    // findUnique returns the updated record
    mockFindUnique.mockResolvedValue(userRecord);

    const result = await verifyEmailToken("valid-token");
    expect(result).not.toBeNull();
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        email_verification_token: "valid-token",
      }),
    }));
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", email_verification_token: "valid-token" },
      data: {
        email_verified: true,
        email_verification_token: null,
        email_verification_expires_at: null,
      },
    }));
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("returns null when token not found or expired (findFirst returns null)", async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await verifyEmailToken("bad-token")).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null when a concurrent request already consumed the token (updateMany count=0)", async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      email_verified: false,
      email_verification_token: "raced-token",
      email_verification_expires_at: futureDate,
    });
    // Simulate the race: another request already cleared the token
    mockUpdateMany.mockResolvedValue({ count: 0 });

    expect(await verifyEmailToken("raced-token")).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("resendVerificationEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns false and does nothing when user not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await resendVerificationEmail("nobody@example.com");
    expect(result).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns false and does nothing when email already verified", async () => {
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      email_verified: true,
      password_hash: "some-hash",
    });
    const result = await resendVerificationEmail("a@b.com");
    expect(result).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns false and does nothing for Google-only account (no password_hash)", async () => {
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "google@b.com",
      name: "Google User",
      email_verified: false,
      password_hash: null,
    });
    const result = await resendVerificationEmail("google@b.com");
    expect(result).toBe(false);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("generates new token, updates user, sends email, returns true for unverified user", async () => {
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      email_verified: false,
      password_hash: "some-hash",
    });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await resendVerificationEmail("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({
        email_verification_token: expect.any(String),
        email_verification_expires_at: expect.any(Date),
      }),
    }));
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.to).toContain("a@b.com");
    expect(emailArgs.subject).toContain("Verify");
  });
});

describe("requestOtp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true without doing anything when user not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await requestOtp("nobody@example.com");
    expect(result).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("returns true without doing anything when user is inactive", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice", is_active: false });
    const result = await requestOtp("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("generates otp_code + otp_token, updates user, sends email, returns true", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice", is_active: true });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await requestOtp("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({
        otp_code: expect.stringMatching(/^\d{6}$/),
        otp_token: expect.any(String),
        otp_expires_at: expect.any(Date),
      }),
    }));
    expect(mockSendEmail).toHaveBeenCalledOnce();
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.subject).toContain("sign-in code");
    expect(emailArgs.html).toContain("sign in directly");
  });

  it("returns true even when email send fails (token still saved)", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice", is_active: true });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockRejectedValue(new Error("SMTP error"));

    const result = await requestOtp("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

describe("verifyOtpCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user on valid code", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      otp_code: "123456",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
    });

    const result = await verifyOtpCode("a@b.com", "123456");
    expect(result).not.toBeNull();
    expect(result?.email).toBe("a@b.com");
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", otp_code: "123456" },
      data: expect.objectContaining({
        otp_code: null,
        otp_token: null,
        otp_expires_at: null,
        last_login_at: expect.any(Date),
      }),
    }));
  });

  it("returns null when code not found or expired (findFirst returns null)", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await verifyOtpCode("a@b.com", "000000");
    expect(result).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null on race condition (updateMany count=0)", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      otp_code: "123456",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await verifyOtpCode("a@b.com", "123456");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("verifyOtpToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user on valid token", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      otp_token: "abc123token",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
    });

    const result = await verifyOtpToken("abc123token");
    expect(result).not.toBeNull();
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", otp_token: "abc123token" },
      data: expect.objectContaining({
        otp_code: null,
        otp_token: null,
        otp_expires_at: null,
        last_login_at: expect.any(Date),
      }),
    }));
  });

  it("returns null when token not found or expired (findFirst returns null)", async () => {
    mockFindFirst.mockResolvedValue(null);
    expect(await verifyOtpToken("bad-token")).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null on race condition (updateMany count=0)", async () => {
    const futureDate = new Date(Date.now() + 15 * 60 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      otp_token: "raced-token",
      otp_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    expect(await verifyOtpToken("raced-token")).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("requestPasswordReset", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true without doing anything when user not found", async () => {
    mockFindUnique.mockResolvedValue(null);
    const result = await requestPasswordReset("nobody@example.com");
    expect(result).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("generates reset token, updates user, sends email, returns true", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice", password_hash: "some-hash" });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await requestPasswordReset("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1" },
      data: expect.objectContaining({
        password_reset_token: expect.any(String),
        password_reset_expires_at: expect.any(Date),
      }),
    }));
    const emailArgs = mockSendEmail.mock.calls[0][0];
    expect(emailArgs.subject).toContain("Reset your password");
  });

  it("works for Google-only accounts (null password_hash)", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "google@b.com", name: "G User", password_hash: null });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockResolvedValue({ id: "e1", skipped: false });

    const result = await requestPasswordReset("google@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("returns true even when email send fails (token still saved)", async () => {
    mockFindUnique.mockResolvedValue({ id: "u1", email: "a@b.com", name: "Alice", password_hash: null });
    mockUpdate.mockResolvedValue({ id: "u1" });
    mockSendEmail.mockRejectedValue(new Error("SMTP error"));

    const result = await requestPasswordReset("a@b.com");
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledOnce();
  });
});

describe("resetPassword", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws password_too_short when password is under 8 characters", async () => {
    await expect(resetPassword("valid-token", "short")).rejects.toThrow("password_too_short");
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns user and updates password_hash on valid token", async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      password_reset_token: "valid-reset-token",
      password_reset_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockFindUnique.mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      name: "Alice",
      role: "ANALYST",
      is_active: true,
      password_hash: "bcrypt-hash",
    });

    const result = await resetPassword("valid-reset-token", "newpassword123");
    expect(result).not.toBeNull();
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "u1", password_reset_token: "valid-reset-token" },
      data: expect.objectContaining({
        password_hash: expect.any(String),
        password_reset_token: null,
        password_reset_expires_at: null,
        last_login_at: expect.any(Date),
      }),
    }));
    const updateData = mockUpdateMany.mock.calls[0][0].data;
    expect(updateData.password_hash).not.toBe("newpassword123");
  });

  it("returns null when token not found or expired", async () => {
    mockFindFirst.mockResolvedValue(null);
    const result = await resetPassword("bad-token", "newpassword123");
    expect(result).toBeNull();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns null on race condition (updateMany count=0)", async () => {
    const futureDate = new Date(Date.now() + 3600 * 1000);
    mockFindFirst.mockResolvedValue({
      id: "u1",
      password_reset_token: "raced-token",
      password_reset_expires_at: futureDate,
    });
    mockUpdateMany.mockResolvedValue({ count: 0 });

    const result = await resetPassword("raced-token", "newpassword123");
    expect(result).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

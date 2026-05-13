import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetToken = vi.fn();
const mockVerifyIdToken = vi.fn();
const mockGenerateAuthUrl = vi.fn();
const mockOAuth2Client = vi.hoisted(() =>
  vi.fn().mockImplementation(function () {
    return {
      generateAuthUrl: mockGenerateAuthUrl,
      getToken: mockGetToken,
      verifyIdToken: mockVerifyIdToken,
    };
  })
);

vi.mock("google-auth-library", () => ({
  OAuth2Client: mockOAuth2Client,
}));

vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "production",
    NEXTAUTH_URL: "https://receivablesageingdashboard.vercel.app",
    GOOGLE_OAUTH_CLIENT_ID: "test-client-id",
    GOOGLE_OAUTH_CLIENT_SECRET: "test-client-secret",
  },
}));

import {
  generateStateToken,
  parseStateToken,
  generateAuthUrl,
  exchangeCodeForUser,
} from "@/lib/google-oauth";

describe("generateStateToken", () => {
  it("returns a base64url state and a nonce", () => {
    const { state, nonce } = generateStateToken("/dashboard");
    expect(typeof state).toBe("string");
    expect(typeof nonce).toBe("string");
    expect(nonce.length).toBeGreaterThan(0);
  });

  it("embeds the next path in the state", () => {
    const { state } = generateStateToken("/invoices");
    const parsed = parseStateToken(state);
    expect(parsed?.next).toBe("/invoices");
  });

  it("nonce in state matches returned nonce", () => {
    const { state, nonce } = generateStateToken("/dashboard");
    const parsed = parseStateToken(state);
    expect(parsed?.nonce).toBe(nonce);
  });
});

describe("parseStateToken", () => {
  it("returns null for invalid base64", () => {
    expect(parseStateToken("!!!notbase64!!!")).toBeNull();
  });

  it("returns null when nonce field is missing", () => {
    const bad = Buffer.from(JSON.stringify({ next: "/dashboard" })).toString("base64url");
    expect(parseStateToken(bad)).toBeNull();
  });

  it("returns null when next field is missing", () => {
    const bad = Buffer.from(JSON.stringify({ nonce: "abc" })).toString("base64url");
    expect(parseStateToken(bad)).toBeNull();
  });

  it("sanitises an external next URL to /dashboard", () => {
    const bad = Buffer.from(
      JSON.stringify({ nonce: "abc", next: "https://evil.com" })
    ).toString("base64url");
    const result = parseStateToken(bad);
    expect(result?.next).toBe("/dashboard");
  });
});

describe("generateAuthUrl", () => {
  it("calls OAuth2Client.generateAuthUrl with the state", () => {
    mockGenerateAuthUrl.mockReturnValue("https://accounts.google.com/o/oauth2/auth?...");
    const url = generateAuthUrl("some-state");
    expect(mockGenerateAuthUrl).toHaveBeenCalledWith(
      expect.objectContaining({ state: "some-state" })
    );
    expect(url).toBe("https://accounts.google.com/o/oauth2/auth?...");
  });
});

describe("exchangeCodeForUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user info from a valid id_token", async () => {
    mockGetToken.mockResolvedValue({
      tokens: { id_token: "fake.id.token" },
    });
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({
        sub: "google-sub-123",
        email: "alice@emb.global",
        name: "Alice",
        hd: "emb.global",
      }),
    });

    const user = await exchangeCodeForUser("auth-code");
    expect(user).toEqual({
      sub: "google-sub-123",
      email: "alice@emb.global",
      name: "Alice",
      hd: "emb.global",
    });
  });

  it("throws when getToken returns no id_token", async () => {
    mockGetToken.mockResolvedValue({ tokens: {} });
    await expect(exchangeCodeForUser("bad-code")).rejects.toThrow("No id_token");
  });

  it("throws when payload is missing email", async () => {
    mockGetToken.mockResolvedValue({ tokens: { id_token: "fake" } });
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => ({ sub: "123" }),
    });
    await expect(exchangeCodeForUser("bad-code")).rejects.toThrow("Invalid token payload");
  });
});

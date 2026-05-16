import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secret-crypto";

const KEY = "x".repeat(40);

describe("secret crypto", () => {
  it("round-trips token material", () => {
    const encrypted = encryptSecret("refresh-token", KEY);

    expect(encrypted).toMatch(/^v1\./);
    expect(encrypted).not.toContain("refresh-token");
    expect(decryptSecret(encrypted, KEY)).toBe("refresh-token");
  });

  it("produces a fresh IV each call", () => {
    const a = encryptSecret("refresh-token", KEY);
    const b = encryptSecret("refresh-token", KEY);
    expect(a).not.toBe(b);
  });

  it("rejects the wrong key", () => {
    const encrypted = encryptSecret("refresh-token", "a".repeat(40));
    expect(() => decryptSecret(encrypted, "b".repeat(40))).toThrow(
      "Secret decryption failed",
    );
  });

  it("rejects keys shorter than 32 characters", () => {
    expect(() => encryptSecret("refresh-token", "short")).toThrow(
      /at least 32 characters/,
    );
  });

  it("rejects malformed ciphertext", () => {
    expect(() => decryptSecret("v1.not-enough-parts", KEY)).toThrow(
      "Malformed encrypted secret",
    );
  });

  it("rejects an unknown version prefix", () => {
    const encrypted = encryptSecret("refresh-token", KEY);
    const tampered = encrypted.replace(/^v1\./, "v2.");
    expect(() => decryptSecret(tampered, KEY)).toThrow(
      "Malformed encrypted secret",
    );
  });
});

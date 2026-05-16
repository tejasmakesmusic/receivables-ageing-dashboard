import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const MIN_KEY_LENGTH = 32;

function keyFromSecret(secret: string): Buffer {
  if (secret.length < MIN_KEY_LENGTH) {
    throw new Error(
      `Token encryption key must be at least ${MIN_KEY_LENGTH} characters`,
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, keyFromSecret(secret), iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(ciphertext: string, secret: string): string {
  const parts = ciphertext.split(".");
  if (parts.length !== 4) {
    throw new Error("Malformed encrypted secret");
  }
  const [version, ivText, tagText, encryptedText] = parts;
  if (
    version !== VERSION ||
    !ivText ||
    !tagText ||
    !encryptedText
  ) {
    throw new Error("Malformed encrypted secret");
  }

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      keyFromSecret(secret),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error("Secret decryption failed");
  }
}

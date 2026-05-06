import { createHmac, timingSafeEqual } from "node:crypto";

export type SignedPayload = {
  userId: string;
  issuedAtEpochMs: number;
};

const SIGNING_ALGORITHM = "sha256";

export function signPayload(payload: SignedPayload, secret: string): string {
  const rawPayload = JSON.stringify(payload);
  const encodedPayload = Buffer.from(rawPayload, "utf8").toString("base64url");
  const signature = createHmac(SIGNING_ALGORITHM, secret)
    .update(encodedPayload)
    .digest()
    .toString("base64url");

  return `${encodedPayload}.${signature}`;
}

export function verifyPayload(
  token: string,
  secret: string,
): SignedPayload | null {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = createHmac(SIGNING_ALGORITHM, secret)
    .update(encodedPayload)
    .digest()
    .toString("base64url");

  const provided = Buffer.from(signature, "base64url");
  const expectedBuffer = Buffer.from(expected, "base64url");

  if (provided.length !== expectedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(provided, expectedBuffer)) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as SignedPayload;

    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.userId !== "string" ||
      parsed.userId.length === 0 ||
      typeof parsed.issuedAtEpochMs !== "number"
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

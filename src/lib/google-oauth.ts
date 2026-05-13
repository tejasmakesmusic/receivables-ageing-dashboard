import { OAuth2Client } from "google-auth-library";
import { env } from "@/lib/env";

const CALLBACK_PATH = "/auth/google/callback";

function getCallbackUrl(): string {
  const base = env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base}${CALLBACK_PATH}`;
}

function getOAuth2Client(): OAuth2Client {
  return new OAuth2Client(
    env.GOOGLE_OAUTH_CLIENT_ID,
    env.GOOGLE_OAUTH_CLIENT_SECRET,
    getCallbackUrl(),
  );
}

export interface StateToken {
  nonce: string;
  next: string;
}

export function generateStateToken(next: string): { state: string; nonce: string } {
  const nonce = crypto.randomUUID();
  const payload: StateToken = { nonce, next };
  const state = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state, nonce };
}

export function parseStateToken(state: string): StateToken | null {
  try {
    const raw = Buffer.from(state, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).nonce !== "string" ||
      typeof (parsed as Record<string, unknown>).next !== "string"
    ) {
      return null;
    }
    const token = parsed as StateToken;
    if (!token.next.startsWith("/") || token.next.startsWith("//")) {
      token.next = "/dashboard";
    }
    return token;
  } catch {
    return null;
  }
}

export function generateAuthUrl(state: string): string {
  return getOAuth2Client().generateAuthUrl({
    access_type: "online",
    scope: ["email", "profile"],
    state,
    prompt: "select_account",
  });
}

export interface GoogleUserInfo {
  sub: string;
  email: string;
  name: string;
  hd?: string;
}

export async function exchangeCodeForUser(code: string): Promise<GoogleUserInfo> {
  const client = getOAuth2Client();
  const { tokens } = await client.getToken(code);

  if (!tokens.id_token) {
    throw new Error("No id_token in Google token response");
  }

  const ticket = await client.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_OAUTH_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload?.email || !payload.sub) {
    throw new Error("Invalid token payload: missing email or sub");
  }

  return {
    sub: payload.sub,
    email: payload.email,
    name: payload.name ?? payload.email,
    hd: payload.hd,
  };
}

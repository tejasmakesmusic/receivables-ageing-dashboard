import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForUser,
  parseStateToken,
} from "@/lib/google-oauth";
import {
  getOrCreateGoogleUser,
  setAuthSessionCookie,
} from "@/server/core/auth";
import { createAuditLog } from "@/server/core/audit";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "google_oauth_state";

function safeRedirectPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const stateParam = searchParams.get("state");

  const googleError = searchParams.get("error");
  if (googleError) {
    console.error("[google/callback] Google returned error:", googleError);
    return NextResponse.redirect(new URL("/auth/google/login", request.url));
  }

  if (!code || !stateParam) {
    console.error("[google/callback] Missing code or state param");
    return NextResponse.redirect(new URL("/auth/google/login", request.url));
  }

  const stateCookie = request.cookies.get(STATE_COOKIE)?.value;
  const stateData = parseStateToken(stateParam);

  if (!stateCookie || !stateData || stateData.nonce !== stateCookie) {
    console.error("[google/callback] State mismatch — stateCookie present:", !!stateCookie, "stateData valid:", !!stateData);
    return NextResponse.redirect(new URL("/auth/google/login", request.url));
  }

  try {
    const googleUser = await exchangeCodeForUser(code);
    const { user, isNew } = await getOrCreateGoogleUser({
      googleSub: googleUser.sub,
      email: googleUser.email,
      name: googleUser.name,
    });

    const redirectPath =
      user.role === role_enum.PENDING
        ? "/auth/pending"
        : safeRedirectPath(stateData.next);

    const response = NextResponse.redirect(new URL(redirectPath, request.url));

    response.cookies.set(STATE_COOKIE, "", { maxAge: 0, path: "/" });

    setAuthSessionCookie(response, user.id);

    await createAuditLog(
      user.id,
      isNew ? "auth.google_signup" : "auth.google_login",
      "user",
      user.id,
      null,
      { email: user.email },
    );

    return response;
  } catch (error) {
    console.error("[google/callback] Token exchange or user lookup failed:", error);
    return NextResponse.redirect(
      new URL("/auth/google/login?error=oauth_failed", request.url),
    );
  }
}

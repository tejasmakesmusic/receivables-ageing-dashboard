import { NextRequest, NextResponse } from "next/server";
import { verifyEmailToken } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(
      new URL("/auth/login?error=token_invalid", request.url),
    );
  }

  try {
    const user = await verifyEmailToken(token);

    if (!user) {
      return NextResponse.redirect(
        new URL("/auth/login?error=token_expired", request.url),
      );
    }

    const response = NextResponse.redirect(
      new URL("/auth/pending", request.url),
    );
    setAuthSessionCookie(response, user.id);
    return response;
  } catch (err) {
    console.error(
      "[verify-email/confirm] unexpected error",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.redirect(
      new URL("/auth/login?error=token_invalid", request.url),
    );
  }
}

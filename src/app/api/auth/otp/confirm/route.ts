import { type NextRequest, NextResponse } from "next/server";
import { verifyOtpToken } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/auth/login?error=token_invalid", request.url));
  }

  try {
    const user = await verifyOtpToken(token);
    if (!user) {
      return NextResponse.redirect(new URL("/auth/login?error=token_expired", request.url));
    }

    const redirectTo = user.role === role_enum.PENDING ? "/auth/pending" : "/dashboard";
    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    setAuthSessionCookie(response, user.id);
    return response;
  } catch (err) {
    console.error("[otp/confirm] unexpected error", err instanceof Error ? err.message : String(err));
    return NextResponse.redirect(new URL("/auth/login?error=server_error", request.url));
  }
}

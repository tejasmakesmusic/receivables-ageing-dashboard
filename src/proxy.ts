import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE_NAME = "next_session";

export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/auth/google/login", request.url);
  loginUrl.searchParams.set("next", request.nextUrl.pathname);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/config/:path*",
    "/dashboard/:path*",
    "/exceptions/:path*",
    "/follow-ups/:path*",
    "/invoice/:path*",
    "/invoices/:path*",
    "/party/:path*",
    "/snapshots/:path*",
    "/upload/:path*",
  ],
};

import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, type RateLimitOptions } from "@/lib/rate-limit";

const SESSION_COOKIE_NAME = "next_session";

// --- Rate limiting ---

const DEFAULT_LIMIT: RateLimitOptions = {
  capacity: 100,
  refillPerSecond: 100 / 60,
};

const UPLOAD_LIMIT: RateLimitOptions = {
  capacity: 10,
  refillPerSecond: 10 / 60,
};

const EMAIL_OUTBOX_PROCESS_LIMIT: RateLimitOptions = {
  capacity: 5,
  refillPerSecond: 5 / 60,
};

function limitForPath(pathname: string): RateLimitOptions {
  if (pathname === "/api/snapshots/upload") {
    return UPLOAD_LIMIT;
  }

  if (pathname === "/api/admin/email-outbox/process") {
    return EMAIL_OUTBOX_PROCESS_LIMIT;
  }

  return DEFAULT_LIMIT;
}

function requestIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();

  return firstForwardedIp || "unknown";
}

// --- Auth redirect ---

export function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Apply rate limiting to all API routes
  if (pathname.startsWith("/api/")) {
    const ip = requestIp(request);
    const result = checkRateLimit(`${ip}:${pathname}`, limitForPath(pathname));

    if (!result.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(result.retryAfterSeconds),
          },
        },
      );
    }
  }

  // Allow Vercel cron / scripted callers to reach API handlers without
  // a session cookie when they present the Bearer CRON_SECRET. The
  // route handlers re-validate (Bearer + role) themselves, so this is
  // just removing the cookie-only middleware redirect from the path.
  // Without this, /api/cron/* and the admin cron endpoints (digest,
  // email-outbox) silently 307 to /auth/login on every scheduled tick.
  if (pathname.startsWith("/api/")) {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");
    if (
      cronSecret &&
      authHeader &&
      authHeader === `Bearer ${cronSecret}`
    ) {
      return NextResponse.next();
    }
  }

  // Require session cookie for protected pages
  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);

    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/admin/:path*",
    "/api/:path*",
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

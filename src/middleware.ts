import { NextRequest, NextResponse } from "next/server";

import { checkRateLimit, type RateLimitOptions } from "@/lib/rate-limit";

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

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const ip = requestIp(request);
  const result = checkRateLimit(`${ip}:${pathname}`, limitForPath(pathname));

  if (result.allowed) {
    return NextResponse.next();
  }

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

export const config = {
  matcher: ["/api/:path*"],
};

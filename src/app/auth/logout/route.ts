import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clearAuthSessionCookie } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";

const logoutResponseSchema = z.object({
  success: z.boolean(),
});

export async function GET(request: NextRequest) {
  try {
    const wantsJson = request.nextUrl.searchParams.get("json") === "1";
    const response = wantsJson
      ? NextResponse.json(logoutResponseSchema.parse({ success: true }))
      : NextResponse.redirect(new URL("/", request.url));
    clearAuthSessionCookie(response);
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST() {
  const response = NextResponse.json(
    logoutResponseSchema.parse({ success: true }),
  );
  clearAuthSessionCookie(response);
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { completeXeroConnection } from "@/server/xero/connections";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(role_enum.ADMIN);
    const state = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const cookieState = request.cookies.get("xero_oauth_state")?.value;
    if (!state || !cookieState || state !== cookieState) {
      throw new HttpError(
        "invalid_oauth_state",
        400,
        "Invalid Xero OAuth state",
      );
    }
    if (!code) {
      throw new HttpError("missing_oauth_code", 400, "Missing Xero OAuth code");
    }
    await completeXeroConnection({
      code,
      entityCode: "UAE",
      currentUser,
    });
    const response = NextResponse.redirect(new URL("/admin/xero", request.url));
    response.cookies.set("xero_oauth_state", "", { path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

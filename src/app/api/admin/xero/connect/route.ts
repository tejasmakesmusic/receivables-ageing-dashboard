import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { toErrorResponse } from "@/server/core/errors";
import { startXeroConnection } from "@/server/xero/connections";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireRole(role_enum.ADMIN);
    const state = randomUUID();
    const url = startXeroConnection(state);
    const response = NextResponse.redirect(url);
    response.cookies.set("xero_oauth_state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

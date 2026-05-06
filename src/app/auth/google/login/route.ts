import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  ensureStubAdminUser,
  isStubProviderEnabled,
  setAuthSessionCookie,
} from "@/server/core/auth";
import { createAuditLog } from "@/server/core/audit";
import { role_enum } from "@/generated/prisma/enums";
import { toErrorResponse } from "@/server/core/errors";

const loginResponseSchema = z.object({
  success: z.boolean(),
  user: z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.nativeEnum(role_enum),
  }),
});

type LoginResponse = z.infer<typeof loginResponseSchema>;

export const dynamic = "force-dynamic";

function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/dashboard";
  }

  return value;
}

export async function GET(request: NextRequest) {
  try {
    if (!isStubProviderEnabled()) {
      return NextResponse.json(
        { error: "google_oauth_not_implemented" },
        { status: 501 },
      );
    }

    const user = await ensureStubAdminUser();
    const responsePayload: LoginResponse = {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    };

    const wantsJson = request.nextUrl.searchParams.get("json") === "1";
    const redirectPath = safeRedirectPath(
      request.nextUrl.searchParams.get("next"),
    );
    const response = wantsJson
      ? NextResponse.json(loginResponseSchema.parse(responsePayload))
      : NextResponse.redirect(new URL(redirectPath, request.url));
    setAuthSessionCookie(response, user.id);
    await createAuditLog(user.id, "auth.stub_login", "user", user.id, null, {
      id: user.id,
      email: user.email,
    });

    return response;
  } catch (error) {
    return toErrorResponse(error);
  }
}

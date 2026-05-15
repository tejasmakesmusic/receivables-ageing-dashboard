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
import { generateAuthUrl, generateStateToken } from "@/lib/google-oauth";
import { env } from "@/lib/env";

const STATE_COOKIE = "google_oauth_state";

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
    const redirectPath = safeRedirectPath(
      request.nextUrl.searchParams.get("next"),
    );

    if (!isStubProviderEnabled()) {
      // If the request arrives on a deployment-specific URL but NEXTAUTH_URL is
      // the stable alias, redirect to the canonical host first. The state cookie
      // must be set on the same domain that Google will redirect back to, or the
      // nonce check in the callback will always fail.
      if (env.NEXTAUTH_URL) {
        const canonicalHost = new URL(env.NEXTAUTH_URL).host;
        const currentHost = request.headers.get("host") ?? request.nextUrl.host;
        if (currentHost !== canonicalHost) {
          const canonical = new URL(
            request.nextUrl.pathname + request.nextUrl.search,
            env.NEXTAUTH_URL,
          );
          return NextResponse.redirect(canonical.toString());
        }
      }

      const { state, nonce } = generateStateToken(redirectPath);
      const authUrl = generateAuthUrl(state);

      const response = NextResponse.redirect(authUrl);
      response.cookies.set(STATE_COOKIE, nonce, {
        httpOnly: true,
        maxAge: 300,
        path: "/",
        secure: env.NODE_ENV === "production",
        sameSite: "lax",
      });
      return response;
    }

    // Stub flow (development / local)
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

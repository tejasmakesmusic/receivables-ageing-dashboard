import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.password) return NextResponse.json({ error: "password_too_short" }, { status: 422 });
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  try {
    const user = await resetPassword(parsed.data.token, parsed.data.password);
    if (!user) {
      return NextResponse.json({ error: "token_expired" }, { status: 400 });
    }

    if (!user.is_active) {
      return NextResponse.json({ error: "account_inactive" }, { status: 403 });
    }

    const redirectTo = user.role === role_enum.PENDING ? "/auth/pending" : "/dashboard";
    const response = NextResponse.json({ success: true, redirectTo });
    setAuthSessionCookie(response, user.id);
    return response;
  } catch (err) {
    if (err instanceof Error && err.message === "password_too_short") {
      return NextResponse.json({ error: "password_too_short" }, { status: 422 });
    }
    console.error("[reset-password] unexpected error", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

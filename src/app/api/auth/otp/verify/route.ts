import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyOtpCode } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/),
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
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  try {
    const user = await verifyOtpCode(parsed.data.email, parsed.data.code);
    if (!user) {
      return NextResponse.json({ error: "invalid_otp" }, { status: 400 });
    }

    const redirectTo = user.role === role_enum.PENDING ? "/auth/pending" : "/dashboard";
    const response = NextResponse.json({ success: true, redirectTo });
    setAuthSessionCookie(response, user.id);
    return response;
  } catch (err) {
    console.error("[otp/verify] unexpected error", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyEmailPassword } from "@/server/core/email-auth";
import { setAuthSessionCookie } from "@/server/core/auth";
import { role_enum } from "@/generated/prisma/enums";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  const { email, password, next } = parsed.data;

  try {
    const user = await verifyEmailPassword(email, password);

    if (!user) {
      return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
    }

    const redirectTo =
      user.role === role_enum.PENDING
        ? "/auth/pending"
        : next && next.startsWith("/") && !next.startsWith("//")
          ? next
          : "/dashboard";

    const response = NextResponse.json({ success: true, redirectTo }, { status: 200 });
    setAuthSessionCookie(response, user.id);
    return response;
  } catch (err) {
    if (err instanceof Error && err.message === "use_google") {
      return NextResponse.json({ error: "use_google" }, { status: 403 });
    }
    if (err instanceof Error && err.message === "email_not_verified") {
      return NextResponse.json({ error: "email_not_verified" }, { status: 403 });
    }
    console.error("[login/password] unexpected error", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

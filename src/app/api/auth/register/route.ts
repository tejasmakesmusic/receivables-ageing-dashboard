import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createEmailPasswordUser } from "@/server/core/email-auth";

export const dynamic = "force-dynamic";

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  confirmPassword: z.string(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    if (issue?.path[0] === "email") {
      return NextResponse.json({ error: "invalid_email" }, { status: 422 });
    }
    if (issue?.path[0] === "password") {
      return NextResponse.json({ error: "password_too_short" }, { status: 422 });
    }
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  const { name, email, password, confirmPassword } = parsed.data;

  if (password !== confirmPassword) {
    return NextResponse.json({ error: "passwords_mismatch" }, { status: 422 });
  }

  try {
    await createEmailPasswordUser({ email, name, password });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "email_taken") {
      return NextResponse.json({ error: "email_taken" }, { status: 409 });
    }
    console.error("[register] unexpected error", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}

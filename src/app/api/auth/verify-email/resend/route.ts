import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resendVerificationEmail } from "@/server/core/email-auth";

export const dynamic = "force-dynamic";

const resendSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = resendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input" }, { status: 422 });
  }

  await resendVerificationEmail(parsed.data.email);
  // Always return success to avoid leaking which emails are registered
  return NextResponse.json({ success: true }, { status: 200 });
}

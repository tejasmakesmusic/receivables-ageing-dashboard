/**
 * Thin Resend wrapper for transactional + digest email delivery.
 *
 * When RESEND_API_KEY is absent (dev without key, CI) the function logs a
 * warning and returns a synthetic "skipped" result instead of throwing.
 * Production must have the key set in Vercel env vars.
 */
import { env } from "@/lib/env";

export interface SendEmailInput {
  to: string[];
  subject: string;
  html: string;
  from?: string; // overrides SMTP_FROM_ADDRESS
}

export interface SendEmailResult {
  id: string | null;
  skipped: boolean;
  error?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY;

  if (!apiKey) {
    // No key configured — log warning, skip sending. This prevents hard failures
    // in development and staging without a Resend account.
    console.warn("[email] RESEND_API_KEY not set — email send skipped", {
      subject: input.subject,
      to: input.to,
    });
    return { id: null, skipped: true };
  }

  const fromAddress =
    input.from ??
    (env.SMTP_FROM_ADDRESS
      ? `${env.SMTP_FROM_NAME ?? "EMB Receivables"} <${env.SMTP_FROM_ADDRESS}>`
      : "EMB Receivables <receivables-bot@emb.global>");

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);

    const result = await resend.emails.send({
      from: fromAddress,
      to: input.to,
      subject: input.subject,
      html: input.html,
    });

    if (result.error) {
      return { id: null, skipped: false, error: result.error.message };
    }

    return { id: result.data?.id ?? null, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { id: null, skipped: false, error: message };
  }
}

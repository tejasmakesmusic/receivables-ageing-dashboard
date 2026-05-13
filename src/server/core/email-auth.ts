import { randomBytes } from "node:crypto";
import { compare, hash } from "bcryptjs";
import { role_enum } from "@/generated/prisma/enums";
import { getPrisma } from "@/lib/prisma";
import { createId } from "@/lib/ids";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";

const BCRYPT_COST = 12;
const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_HOURS = 24;

export type EmailUserRecord = {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: boolean;
  email_verified: boolean;
  email_verification_token: string | null;
  email_verification_expires_at: Date | null;
};

export function generateVerificationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export async function createEmailPasswordUser({
  email,
  name,
  password,
}: {
  email: string;
  name: string;
  password: string;
}): Promise<{ user: EmailUserRecord }> {
  const prisma = getPrisma();

  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) {
    throw new Error("email_taken");
  }

  const password_hash = await hash(password, BCRYPT_COST);
  const email_verification_token = generateVerificationToken();
  const email_verification_expires_at = new Date(
    Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  const user = await prisma.users.create({
    data: {
      id: createId(),
      email,
      name,
      password_hash,
      role: role_enum.PENDING,
      is_active: true,
      email_verified: false,
      email_verification_token,
      email_verification_expires_at,
    },
  });

  await sendVerificationEmail({ to: email, name, token: email_verification_token });

  return { user: user as unknown as EmailUserRecord };
}

export async function verifyEmailPassword(
  email: string,
  password: string,
): Promise<EmailUserRecord | null> {
  const prisma = getPrisma();

  const user = await prisma.users.findUnique({ where: { email } });
  if (!user) return null;

  if (!user.password_hash) {
    throw new Error("use_google");
  }

  if (!user.email_verified) {
    throw new Error("email_not_verified");
  }

  const valid = await compare(password, user.password_hash);
  if (!valid) return null;

  const updated = await prisma.users.update({
    where: { id: user.id },
    data: { last_login_at: new Date() },
  });

  return updated as unknown as EmailUserRecord;
}

export async function verifyEmailToken(
  token: string,
): Promise<EmailUserRecord | null> {
  const prisma = getPrisma();

  const user = await prisma.users.findUnique({
    where: { email_verification_token: token },
  });

  if (!user) return null;

  if (
    !user.email_verification_expires_at ||
    user.email_verification_expires_at < new Date()
  ) {
    return null;
  }

  const updated = await prisma.users.update({
    where: { id: user.id },
    data: {
      email_verified: true,
      email_verification_token: null,
      email_verification_expires_at: null,
    },
  });

  return updated as unknown as EmailUserRecord;
}

export async function resendVerificationEmail(email: string): Promise<boolean> {
  const prisma = getPrisma();

  const user = await prisma.users.findUnique({ where: { email } });
  if (!user || user.email_verified || !user.password_hash) return false;

  const email_verification_token = generateVerificationToken();
  const email_verification_expires_at = new Date(
    Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  await prisma.users.update({
    where: { id: user.id },
    data: { email_verification_token, email_verification_expires_at },
  });

  await sendVerificationEmail({ to: email, name: user.name, token: email_verification_token });
  return true;
}

async function sendVerificationEmail({
  to,
  name,
  token,
}: {
  to: string;
  name: string;
  token: string;
}) {
  const baseUrl =
    env.NEXTAUTH_URL ?? "https://receivablesageingdashboard.vercel.app";
  const link = `${baseUrl}/api/auth/verify-email/confirm?token=${token}`;

  await sendEmail({
    to: [to],
    subject: "Verify your email — EMB Receivables",
    html: `
      <p>Hi ${name},</p>
      <p>Click the link below to verify your email address and activate your account:</p>
      <p><a href="${link}">Verify my email</a></p>
      <p>This link expires in 24 hours.</p>
      <p>If you didn't create an account, you can ignore this email.</p>
      <p>— EMB Receivables</p>
    `,
  });
}

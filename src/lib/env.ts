import { z } from "zod";

if (typeof window === "undefined") {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
  config({ path: ".env" });
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required for Prisma connections")
    .optional(),
  DATABASE_ADAPTER: z.enum(["neon", "pg"]).optional(),
  AUTH_PROVIDER: z.enum(["google", "stub", "development"]).default("google"),
  NEXTAUTH_URL: z.string().url().optional(),
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  NEXT_PUBLIC_APP_NAME: z.string().default("Receivables Ageing Dashboard"),
  // Email delivery
  RESEND_API_KEY: z.string().optional(),
  SMTP_FROM_ADDRESS: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().optional(),
  // Vercel Blob — retained source workbooks (set automatically when Blob store is linked).
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  // Cloudflare R2 — pg_dump backup cron (separate from workbook uploads).
  R2_BUCKET: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  // ExchangeRate-API - Admin-triggered immutable FX rate imports.
  EXCHANGERATE_API_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

export function toPrismaDatabaseUrl(databaseUrl: string): string {
  return databaseUrl
    .replace(/^postgresql\+psycopg:\/\//, "postgresql://")
    .replace(/^postgres\+psycopg:\/\//, "postgres://");
}

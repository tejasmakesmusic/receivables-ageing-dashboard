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
  NEXT_PUBLIC_APP_NAME: z.string().default("Receivables Ageing Dashboard"),
  // Email delivery
  RESEND_API_KEY: z.string().optional(),
  SMTP_FROM_ADDRESS: z.string().email().optional(),
  SMTP_FROM_NAME: z.string().optional(),
  // Object storage for retained source workbooks.
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

export function toPrismaDatabaseUrl(databaseUrl: string): string {
  return databaseUrl
    .replace(/^postgresql\+psycopg:\/\//, "postgresql://")
    .replace(/^postgres\+psycopg:\/\//, "postgres://");
}

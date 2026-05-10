// Sentry is an optional production dependency. We use require() so Turbopack
// treats it as an external and doesn't fail when the package is absent locally.
// The hasSentryDsn() guard ensures we never actually call require() in dev.

/* eslint-disable @typescript-eslint/no-require-imports */

type SentryModule = {
  init(options: unknown): void;
  captureException(error: unknown): void;
};

let sentryInstance: SentryModule | null = null;
let sentryInitialized = false;

function hasSentryDsn(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

function tryLoadSentry(): SentryModule | null {
  if (!hasSentryDsn()) return null;

  try {
    const mod = require("@sentry/nextjs");
    if (
      typeof mod.init === "function" &&
      typeof mod.captureException === "function"
    ) {
      return mod as SentryModule;
    }
  } catch {
    // package not installed — silently skip
  }

  return null;
}

export async function initializeSentry(): Promise<void> {
  if (sentryInitialized || !hasSentryDsn()) return;

  sentryInstance = tryLoadSentry();
  if (!sentryInstance) return;

  sentryInstance.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? "development",
  });
  sentryInitialized = true;
}

export function captureException(error: unknown): void {
  if (!hasSentryDsn()) return;

  if (!sentryInstance) {
    sentryInstance = tryLoadSentry();
  }

  sentryInstance?.captureException(error);
}

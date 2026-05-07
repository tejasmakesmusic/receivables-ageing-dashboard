type SentryModule = {
  init(options: unknown): void;
  captureException(error: unknown): void;
};

const sentryModuleName = "@sentry/nextjs";

let sentryModulePromise: Promise<SentryModule | null> | null = null;
let sentryInitialized = false;

function hasSentryDsn(): boolean {
  return Boolean(process.env.SENTRY_DSN);
}

async function loadSentry(): Promise<SentryModule | null> {
  if (!hasSentryDsn()) {
    return null;
  }

  sentryModulePromise ??= import(sentryModuleName)
    .then((module): SentryModule | null => {
      const candidate = module as Partial<SentryModule>;
      if (
        typeof candidate.init !== "function" ||
        typeof candidate.captureException !== "function"
      ) {
        return null;
      }

      return candidate as SentryModule;
    })
    .catch(() => null);

  return sentryModulePromise;
}

export async function initializeSentry(): Promise<void> {
  if (sentryInitialized || !hasSentryDsn()) {
    return;
  }

  const Sentry = await loadSentry();
  if (!Sentry) {
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV ?? "development",
  });
  sentryInitialized = true;
}

export function captureException(error: unknown): void {
  if (!hasSentryDsn()) {
    return;
  }

  void loadSentry().then((Sentry) => {
    Sentry?.captureException(error);
  });
}

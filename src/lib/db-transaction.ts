import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "./prisma";

export type TxClient = Omit<
  ReturnType<typeof getPrisma>,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type TxOptions = {
  maxWait: number;
  timeout: number;
};

const SLOW_TX_MS = 3_000;
const isDev = process.env.NODE_ENV === "development";

/**
 * Wrap every interactive transaction through this helper instead of calling
 * getPrisma().$transaction() directly. Benefits:
 *
 *  - Explicit timeouts are required — no silent 5 s default.
 *  - In dev, logs label + wall-clock duration on every call.
 *  - On timeout, the thrown error includes the label and elapsed time so the
 *    server log immediately identifies which code path expired.
 */
export async function dbTransaction<T>(
  label: string,
  fn: (tx: TxClient) => Promise<T>,
  options: TxOptions,
): Promise<T> {
  const start = Date.now();

  if (isDev) {
    console.log(`[tx:${label}] start (timeout=${options.timeout}ms)`);
  }

  try {
    const result = await getPrisma().$transaction(
      fn as (tx: Prisma.TransactionClient) => Promise<T>,
      options,
    );

    const elapsed = Date.now() - start;
    if (isDev) {
      const mark = elapsed > SLOW_TX_MS ? "⚠ SLOW" : "✓";
      console.log(`[tx:${label}] ${mark} ${elapsed}ms`);
    }

    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    if (isDev) {
      console.error(`[tx:${label}] ✗ failed after ${elapsed}ms`);
    }

    // Enrich Prisma interactive-transaction timeout errors.
    if (
      error instanceof Error &&
      (error.message.includes("expired transaction") ||
        error.message.includes("Transaction already closed"))
    ) {
      const enriched = new Error(
        `[db-transaction/${label}] timed out after ${elapsed}ms ` +
          `(limit ${options.timeout}ms, maxWait ${options.maxWait}ms). ` +
          `Consider batching queries or raising the timeout.`,
      );
      enriched.cause = error;
      throw enriched;
    }

    throw error;
  }
}

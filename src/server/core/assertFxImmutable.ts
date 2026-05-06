import { HttpError } from "@/server/core/errors";

/**
 * Runtime guard that prevents any UPDATE or DELETE on fx_rates.
 * FX rate rows are immutable by design — only INSERT and SELECT are allowed.
 *
 * Call this guard inside any service-layer function that could mutate fx_rates,
 * and wire the corresponding route handler to respond 405 for PATCH/PUT/DELETE.
 *
 * @throws HttpError 405 Method Not Allowed
 */
export function assertFxImmutable(): never {
  throw new HttpError(
    "method_not_allowed",
    405,
    "FX rate rows are immutable. Use a new INSERT to supersede a rate.",
  );
}

import { HttpError } from "@/server/core/errors";

/**
 * Sanity guard: verifies that the provided date value is a DATE-shaped string
 * (YYYY-MM-DD) and not a full wall-clock timestamp or a Date object derived
 * from new Date() / Date.now().
 *
 * All ageing arithmetic must use snapshot.as_of_date, never the wall-clock today.
 * Call this guard when accepting an as_of_date from an external input before
 * passing it to any ageing service.
 *
 * @throws HttpError 400 Bad Request if the value fails validation
 */
export function assertSnapshotAsOfBased(asOfDate: unknown): asserts asOfDate is string {
  if (typeof asOfDate !== "string") {
    throw new HttpError(
      "invalid_as_of_date",
      400,
      `as_of_date must be a DATE string (YYYY-MM-DD), received: ${typeof asOfDate}`,
    );
  }

  // Must match YYYY-MM-DD exactly — no time component allowed
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new HttpError(
      "invalid_as_of_date",
      400,
      `as_of_date must be formatted YYYY-MM-DD, received: "${asOfDate}"`,
    );
  }
}

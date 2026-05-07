import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkRateLimit, resetRateLimitForTests } from "@/lib/rate-limit";

const opts = { capacity: 2, refillPerSecond: 1 };

describe("rate limit token bucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-07T00:00:00.000Z"));
    resetRateLimitForTests();
  });

  afterEach(() => {
    resetRateLimitForTests();
    vi.useRealTimers();
  });

  it("allows up to capacity then blocks with a retry delay", () => {
    expect(checkRateLimit("ip-a:/api/test", opts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(checkRateLimit("ip-a:/api/test", opts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });

    expect(checkRateLimit("ip-a:/api/test", opts)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });

  it("refill restores tokens after enough time", () => {
    const slowOpts = { capacity: 1, refillPerSecond: 0.5 };

    expect(checkRateLimit("ip-a:/api/test", slowOpts).allowed).toBe(true);
    expect(checkRateLimit("ip-a:/api/test", slowOpts)).toEqual({
      allowed: false,
      retryAfterSeconds: 2,
    });

    vi.advanceTimersByTime(2_000);

    expect(checkRateLimit("ip-a:/api/test", slowOpts)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it("keeps different keys independent", () => {
    expect(checkRateLimit("ip-a:/api/test", { capacity: 1, refillPerSecond: 1 }))
      .toMatchObject({ allowed: true });
    expect(checkRateLimit("ip-a:/api/test", { capacity: 1, refillPerSecond: 1 }))
      .toMatchObject({ allowed: false });

    expect(checkRateLimit("ip-b:/api/test", { capacity: 1, refillPerSecond: 1 }))
      .toMatchObject({ allowed: true });
  });

  it("resetRateLimitForTests clears state", () => {
    expect(checkRateLimit("ip-a:/api/test", { capacity: 1, refillPerSecond: 1 }))
      .toMatchObject({ allowed: true });
    expect(checkRateLimit("ip-a:/api/test", { capacity: 1, refillPerSecond: 1 }))
      .toMatchObject({ allowed: false });

    resetRateLimitForTests();

    expect(checkRateLimit("ip-a:/api/test", { capacity: 1, refillPerSecond: 1 }))
      .toMatchObject({ allowed: true });
  });
});

type Bucket = {
  tokens: number;
  lastRefill: number;
};

export type RateLimitOptions = {
  capacity: number;
  refillPerSecond: number;
};

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  const now = Date.now() / 1000;
  const existing = buckets.get(key) ?? {
    tokens: opts.capacity,
    lastRefill: now,
  };

  const elapsedSeconds = Math.max(0, now - existing.lastRefill);
  const tokens = Math.min(
    opts.capacity,
    existing.tokens + elapsedSeconds * opts.refillPerSecond,
  );
  const bucket = { tokens, lastRefill: now };
  buckets.set(key, bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const retryAfterSeconds = Math.ceil(
    (1 - bucket.tokens) / opts.refillPerSecond,
  );

  return { allowed: false, retryAfterSeconds };
}

export function resetRateLimitForTests(): void {
  buckets.clear();
}

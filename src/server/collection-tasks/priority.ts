/**
 * Priority score for collection tasks.
 *
 * Pure function — no side effects, no DB calls.
 * Score ranges from 0–100 (higher = more urgent).
 *
 * Weights:
 *  - Ageing bucket:     0–40 pts  (90_PLUS = 40, 61_90 = 30, 31_60 = 20, 0_30 = 10, NOT_DUE = 0)
 *  - Outstanding amount: 0–30 pts  (proportional to HIGH_VALUE_THRESHOLD, capped at 30)
 *  - Broken PTP:        +20 pts
 *  - Open dispute:      +10 pts
 *  - Stale contact:     +5  pts
 */
export interface PriorityInput {
  bucket: string;
  outstandingAmount: number;
  highValueThreshold: number;
  hasBrokenPtp: boolean;
  hasOpenDispute: boolean;
  isStaleContact: boolean;
}

export function computePriorityScore(input: PriorityInput): number {
  const {
    bucket,
    outstandingAmount,
    highValueThreshold,
    hasBrokenPtp,
    hasOpenDispute,
    isStaleContact,
  } = input;

  let score = 0;

  // Ageing bucket weight — must match ageingBucket() strings in snapshots/service.ts
  if (bucket === "90_PLUS") score += 40;
  else if (bucket === "61_90") score += 30;
  else if (bucket === "31_60") score += 20;
  else if (bucket === "0_30") score += 10;
  // "NOT_DUE" = 0

  // Amount weight (0–30, proportional to threshold, capped)
  const amountRatio = Math.min(outstandingAmount / highValueThreshold, 1);
  score += Math.round(amountRatio * 30);

  // Behavioural signals
  if (hasBrokenPtp) score += 20;
  if (hasOpenDispute) score += 10;
  if (isStaleContact) score += 5;

  return Math.min(score, 100);
}

/**
 * Priority score unit tests — no DB required.
 *
 * Critical: verifies that bucket string literals match what ageingBucket()
 * writes to invoice_snapshots.bucket (the H1 bug from Phase 3 review).
 */
import { describe, it, expect } from "vitest";
import { computePriorityScore } from "@/server/collection-tasks/priority";

const BASE = {
  bucket: "NOT_DUE",
  outstandingAmount: 0,
  highValueThreshold: 100_000,
  hasBrokenPtp: false,
  hasOpenDispute: false,
  isStaleContact: false,
};

describe("computePriorityScore — bucket strings", () => {
  it('bucket "90_PLUS" contributes 40 pts', () => {
    const score = computePriorityScore({ ...BASE, bucket: "90_PLUS" });
    expect(score).toBe(40);
  });

  it('bucket "61_90" contributes 30 pts', () => {
    const score = computePriorityScore({ ...BASE, bucket: "61_90" });
    expect(score).toBe(30);
  });

  it('bucket "31_60" contributes 20 pts', () => {
    const score = computePriorityScore({ ...BASE, bucket: "31_60" });
    expect(score).toBe(20);
  });

  it('bucket "0_30" contributes 10 pts', () => {
    const score = computePriorityScore({ ...BASE, bucket: "0_30" });
    expect(score).toBe(10);
  });

  it('bucket "NOT_DUE" contributes 0 pts', () => {
    const score = computePriorityScore({ ...BASE, bucket: "NOT_DUE" });
    expect(score).toBe(0);
  });

  // Regression guard: old wrong strings must NOT match
  it('old wrong string "90+" does NOT score 40 pts (regression guard)', () => {
    const score = computePriorityScore({ ...BASE, bucket: "90+" });
    expect(score).not.toBe(40);
    expect(score).toBe(0); // unknown bucket = 0 bucket pts
  });

  it('old wrong string "61-90" does NOT score 30 pts (regression guard)', () => {
    const score = computePriorityScore({ ...BASE, bucket: "61-90" });
    expect(score).not.toBe(30);
  });
});

describe("computePriorityScore — signal weights", () => {
  it("broken PTP adds 20 pts", () => {
    const withPtp = computePriorityScore({ ...BASE, hasBrokenPtp: true });
    const without = computePriorityScore({ ...BASE });
    expect(withPtp - without).toBe(20);
  });

  it("open dispute adds 10 pts", () => {
    const with_ = computePriorityScore({ ...BASE, hasOpenDispute: true });
    const without = computePriorityScore({ ...BASE });
    expect(with_ - without).toBe(10);
  });

  it("stale contact adds 5 pts", () => {
    const with_ = computePriorityScore({ ...BASE, isStaleContact: true });
    const without = computePriorityScore({ ...BASE });
    expect(with_ - without).toBe(5);
  });

  it("amount at threshold contributes exactly 30 pts", () => {
    const score = computePriorityScore({
      ...BASE,
      outstandingAmount: 100_000,
      highValueThreshold: 100_000,
    });
    expect(score).toBe(30);
  });

  it("amount at 50% of threshold contributes 15 pts", () => {
    const score = computePriorityScore({
      ...BASE,
      outstandingAmount: 50_000,
      highValueThreshold: 100_000,
    });
    expect(score).toBe(15);
  });

  it("amount above threshold is capped at 30 pts", () => {
    const score = computePriorityScore({
      ...BASE,
      outstandingAmount: 999_999,
      highValueThreshold: 100_000,
    });
    expect(score).toBe(30);
  });

  it("maximum possible score is capped at 100", () => {
    const score = computePriorityScore({
      bucket: "90_PLUS",
      outstandingAmount: 999_999,
      highValueThreshold: 1,
      hasBrokenPtp: true,
      hasOpenDispute: true,
      isStaleContact: true,
    });
    expect(score).toBe(100);
  });

  it("zero amount and no signals = 0 pts for unknown bucket", () => {
    expect(computePriorityScore({ ...BASE })).toBe(0);
  });
});

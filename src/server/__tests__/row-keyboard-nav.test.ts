import { describe, expect, it } from "vitest";
import { getNextRovingIndex } from "@/components/interaction/roving-focus";

describe("roving row keyboard navigation", () => {
  it("moves through rows with wrapping by default", () => {
    expect(
      getNextRovingIndex({ currentIndex: 0, itemCount: 3, key: "ArrowDown" }),
    ).toBe(1);
    expect(
      getNextRovingIndex({ currentIndex: 2, itemCount: 3, key: "ArrowDown" }),
    ).toBe(0);
    expect(
      getNextRovingIndex({ currentIndex: 0, itemCount: 3, key: "ArrowUp" }),
    ).toBe(2);
  });

  it("can clamp at boundaries", () => {
    expect(
      getNextRovingIndex({
        currentIndex: 2,
        itemCount: 3,
        key: "ArrowDown",
        wrap: false,
      }),
    ).toBe(2);
  });
});

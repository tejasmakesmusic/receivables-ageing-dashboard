import { describe, expect, it } from "vitest";
import {
  getKeyboardCommand,
  KEYBOARD_COMMAND_KEYS,
} from "@/components/interaction/keyboard-command-presets";

describe("interaction keyboard presets", () => {
  it("defines the Sprint 3 keyboard command contract", () => {
    expect(KEYBOARD_COMMAND_KEYS).toMatchObject({
      OPEN: ["Enter"],
      CANCEL: ["Escape"],
      MOVE_NEXT: ["ArrowDown"],
      MOVE_PREVIOUS: ["ArrowUp"],
      TOGGLE_VIEW: ["v"],
      EDIT_ACTIVE: ["e"],
      CREATE_ACTIVE: ["c"],
    });
  });

  it("normalizes single-letter commands", () => {
    expect(getKeyboardCommand("E")).toBe("EDIT_ACTIVE");
    expect(getKeyboardCommand("c")).toBe("CREATE_ACTIVE");
    expect(getKeyboardCommand("ArrowDown")).toBe("MOVE_NEXT");
  });
});

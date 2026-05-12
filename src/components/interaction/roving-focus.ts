import { KEYBOARD_COMMAND_KEYS } from "./keyboard-command-presets";

export function getNextRovingIndex({
  currentIndex,
  itemCount,
  key,
  wrap = true,
}: {
  currentIndex: number;
  itemCount: number;
  key: string;
  wrap?: boolean;
}): number {
  if (itemCount <= 0) {
    return -1;
  }

  if ((KEYBOARD_COMMAND_KEYS.MOVE_NEXT as readonly string[]).includes(key)) {
    const next = currentIndex + 1;
    return next < itemCount ? next : wrap ? 0 : itemCount - 1;
  }

  if ((KEYBOARD_COMMAND_KEYS.MOVE_PREVIOUS as readonly string[]).includes(key)) {
    const previous = currentIndex - 1;
    return previous >= 0 ? previous : wrap ? itemCount - 1 : 0;
  }

  return Math.min(Math.max(currentIndex, 0), itemCount - 1);
}

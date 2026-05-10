export const KEYBOARD_COMMAND_KEYS = {
  OPEN: ["Enter"],
  CANCEL: ["Escape"],
  MOVE_NEXT: ["ArrowDown"],
  MOVE_PREVIOUS: ["ArrowUp"],
  TOGGLE_VIEW: ["v"],
  EDIT_ACTIVE: ["e"],
  CREATE_ACTIVE: ["c"],
} as const;

export type KeyboardCommand =
  | "OPEN"
  | "CANCEL"
  | "MOVE_NEXT"
  | "MOVE_PREVIOUS"
  | "TOGGLE_VIEW"
  | "EDIT_ACTIVE"
  | "CREATE_ACTIVE";

export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === "input" ||
    tagName === "textarea" ||
    tagName === "select" ||
    target.isContentEditable
  );
}

export function getKeyboardCommand(key: string): KeyboardCommand | null {
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;

  for (const [command, keys] of Object.entries(KEYBOARD_COMMAND_KEYS)) {
    if ((keys as readonly string[]).includes(normalizedKey)) {
      return command as KeyboardCommand;
    }
  }

  return null;
}

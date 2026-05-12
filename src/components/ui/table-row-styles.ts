export const TABLE_ROW_INTERACTIVE_CLASS =
  "group transition-colors hover:bg-[var(--color-bg-subtle)] focus-visible:bg-[var(--color-accent-soft)] focus-visible:outline-none";
export const TABLE_ROW_SELECTED_CLASS = "bg-[var(--color-accent-soft)]";

export function getInteractiveRowClass(options?: { selected?: boolean }) {
  return options?.selected
    ? `${TABLE_ROW_INTERACTIVE_CLASS} ${TABLE_ROW_SELECTED_CLASS}`
    : TABLE_ROW_INTERACTIVE_CLASS;
}

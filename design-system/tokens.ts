export const uiV2Tokens = {
  color: {
    primary: "var(--color-accent)",
    bg: "var(--color-bg)",
    fg: "var(--color-text)",
    border: "var(--color-border)",
    subtle: "var(--color-bg-subtle)",
    muted: "var(--color-text-muted)",
    success: "var(--color-success)",
    warning: "var(--color-warning)",
    danger: "var(--color-danger)",
    info: "var(--color-info)",
  },
  type: {
    pageTitle: "24px/32px",
    sectionTitle: "18px/28px",
    body: "14px/20px",
    meta: "12px/16px",
  },
  spacing: [4, 8, 12, 16, 20, 24, 32, 40, 56],
  radius: {
    sm: 6,
    md: 8,
    lg: 12,
    pill: 999,
  },
  motion: {
    fast: "150ms ease-out",
    panel: "200ms ease-out",
  },
} as const;

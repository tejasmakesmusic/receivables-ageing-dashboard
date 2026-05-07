# Accessibility Baseline

Scope: PRD 9.17 review for the light theme Storybook handoff. This is a
static code and token review; it does not replace browser or screen-reader UAT.

## Verified

- Neutral contrast: `--color-text` `#333333` on white is 12.63:1; `--color-text-muted` `#666666` on white is 5.74:1. Both meet WCAG AA for normal text.
- Accent contrast: white text on `--color-accent` `#2563eb` is 5.17:1; accent text `#1d4ed8` on `--color-accent-soft` `#eaf1ff` is 5.91:1. Both meet WCAG AA.
- Status tag contrast: finance tag text/background pairs meet WCAG AA for normal text: neutral 5.08:1, info 5.91:1, current 5.34:1, warning 5.13:1, alert 5.26:1, danger 5.94:1.
- Status badges expose text labels through `StatusTag`; Storybook includes every PRD 9.5 semantic finance state so color is not the only signal.
- Focus visibility exists on the shared `Button` primitive through a 2px accent `focus-visible` ring.
- Table sorting uses real links with `aria-sort`; side-panel full-page actions use labeled links; progress path marks the active step with `aria-current="step"`.
- Engagement components expose semantics where present: `GoalChip` uses `role="progressbar"` with value bounds, and `StreakBadge` has an accessible label plus tooltip text.

## Open

- `--color-text-subtle` `#999999` on white is 2.85:1 and `--color-text-disabled` `#b3b3b3` on white is 2.10:1. Keep subtle text decorative or nonessential; disabled text is acceptable only for disabled controls. Any required helper text should use `--color-text-muted`.
- Keyboard acceptance still needs interactive verification in Storybook or the app for `/` global search focus, Cmd/Ctrl+K command menu, Esc close behavior, Enter activation, side-panel traversal, modal trapping, and table row actions.
- Reduced-motion behavior is not yet covered by an automated test. Engagement feedback must remain usable when `prefers-reduced-motion: reduce` is active.
- Hit areas are partially verified: shell links and default buttons are at least 40px high, but mobile/tablet tap-target review should confirm >=44px where feasible for compact table actions and nudge controls.
- Shortcut discoverability is partial. `StreakBadge` has tooltip text, but command-menu rows and icon actions still need review to ensure accelerators are visible where PRD 9.17 requires them.
- Multi-field validation summaries and screen-reader form error announcements need workflow-level review in upload, publish, override, PTP, dispute, and saved-view forms.

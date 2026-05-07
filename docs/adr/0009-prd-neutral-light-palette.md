# ADR 0009 - Adopt PRD Section 9.4 Neutral-Light Palette

- **Status:** Accepted
- **Date:** 2026-05-07
- **Related:** PRD `Receivables_OS_PRD_Twenty_Duolingo_UX_Guidelines.md` sections 9.4-9.5

## Context

Phase 9 introduced a "warm command-center" UI slice that used a beige neutral
palette (`--color-bg-subtle: #fcfbf9`, `--color-bg-muted: #f5f2ee`,
`--color-border: #ebe7df`) and a slate text scale (`#111827 / #5f6b7a / #8a95a3`).

The locked PRD specifies a Twenty-inspired neutral-light system as the visual
foundation for finance work surfaces:

| Token | PRD value |
|---|---|
| `background.primary` | `#FFFFFF` |
| `background.secondary` | `#FCFCFC` |
| `background.tertiary` | `#F1F1F1` |
| `border.light / medium / strong` | `#F1F1F1 / #EBEBEB / #D6D6D6` |
| `font.primary / secondary / tertiary / light` | `#333333 / #666666 / #999999 / #B3B3B3` |

The warm beige tokens drift from the PRD and reduce contrast on dense tables
(13px body text on `#fcfbf9` is closer to AA borderline than on `#fcfcfc`).

## Decision

Realign the global token map in `src/app/globals.css` to the PRD Section 9.4 values.
Token *names* are preserved so existing `var(--color-...)` references continue to
resolve; only the underlying hex values change. New tokens
`--color-border-medium` and `--color-text-disabled` are added to cover PRD
states that previously had no token.

Accent (`#2563eb`), finance semantic colors (success / warning / danger /
violet), and ageing/status badge tokens remain unchanged - these are already
PRD-compliant via `getStatusTag`.

## Consequences

- The app surface reads as neutral-cool rather than warm. Sidebar and main
  surfaces use white/near-white; grouped sections use `#F1F1F1`.
- Contrast against PRD recommended `font.primary` (#333333) improves over the
  prior #111827 in some accessibility audits because text blocks sit on truly
  neutral surfaces, and `getStatusTag` colors retain WCAG AA against the new
  backgrounds.
- No code references break: token names are stable.
- This ADR supersedes the warm-palette decision implied by the Phase 9
  command-center slice.

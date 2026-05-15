# Receivables OS UI V2 Design Notes

## Scope

This first UI V2 slice adds a design-system foundation and refactors Home and Upload behind `NEXT_PUBLIC_UI_V2=true`. Existing routes, data fetching, RBAC, API contracts, and domain terms are preserved.

## Tokens

- Color: indigo accent, neutral surface scale, semantic success/warning/danger/info slots, and dark-mode variable parity.
- Type: page title `24/32`, section title `18/28`, body `14/20`, meta `12/16`.
- Spacing: `4, 8, 12, 16, 20, 24, 32, 40, 56`.
- Radius: small `6`, medium `8`, large `12`, pill `999`.
- Motion: `150ms` hover/press and `200ms` panel motion, with `prefers-reduced-motion`.

## Component API

- `DsButton`: primary, secondary, ghost, destructive, icon sizing.
- `DsCard`: title, subtitle, actions, and content slot.
- `DsBadge`: semantic pill with required dot icon.
- `DsInput`: accessible text input with shared focus ring.
- `DsTextarea`: multi-line note input with shared focus treatment.
- `DsSelect`: custom segmented select with hidden form value.
- `DsCombobox`: searchable listbox-style selection backed by a hidden form value.
- `DsDatePicker`: text date entry plus recent-date quick picks, backed by a hidden form value.
- `DsDataTable`: overflow shell for dense tables.
- `DsEmptyState`: illustration, headline, support copy, CTA slot.
- `DsKpiCard`: label, value, and footnote.
- `DsFileDropzone`: drag-and-drop workbook selection with preview.
- `DsStatusPill`: canonical semantic state pill for shared workflow states.
- `DsSkeleton`: loading placeholder for rows, KPI cards, and panels.
- `DsFilterBar`: segmented tabs plus active-filter chip surface.
- `DsStepper`: horizontal or vertical workflow progress indicator.
- `DsContextPanel`: right-side context module container.
- `DsDrawer`: slide-over container for row detail.
- `DsTooltip`: tooltip wrapper for icon-only and compact controls.
- `DsToastViewport`: bottom-right toast live region placeholder.

## Migration map

| Old pattern | New UI V2 component |
| --- | --- |
| Native `button` utility classes | `DsButton` |
| `Card`, `CardHeader`, `CardContent` combinations | `DsCard` |
| Native `select` | `DsSelect` |
| Native `input type=date` | `DsDatePicker` |
| Native `input type=file` | `DsFileDropzone` |
| Ad hoc empty blocks | `DsEmptyState` |
| `MetricCard` on Home | `DsKpiCard` |
| Ad hoc status badges | `DsStatusPill` |
| Page right rail cards | `DsContextPanel` |

## Accessibility checklist

- Interactive elements use visible 2px indigo focus rings.
- Badges include a dot icon and text, not color alone.
- Home work queue headers use `scope="col"`.
- Upload form fields retain labels and `aria-live` status messaging.
- UI V2 avoids native select/date/file controls in the refactored Upload surface.

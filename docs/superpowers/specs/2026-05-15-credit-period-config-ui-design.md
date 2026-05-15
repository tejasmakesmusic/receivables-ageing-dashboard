# Credit Period Config UI — Dedicated Management Subpage

**Date:** 2026-05-15
**Scope:** Add full CRUD UI for `credit_period_config` rows. Backend routes already exist; this is purely a frontend + one new API endpoint.

---

## Problem

`/config` shows the Credit Periods table as a read-only 5-row preview. Analysts and admins cannot create or edit credit period configs from the UI — they need a direct DB write. This is the most common cause of the `credit_days_missing` 422 at publish time.

---

## A — Architecture

### Approach

Dedicated subpage at `/config/credit-periods`. Server Component page with URL-driven filters. Client Components for the filter controls and create/edit sheet. Consistent with every other page in the codebase.

### Files

| Action | Path | Responsibility |
|--------|------|----------------|
| New | `src/server/parties/search.ts` | `searchParties()` — scoped party name search |
| New | `src/app/api/parties/route.ts` | `GET /api/parties?name_contains=&entity_code=&page_size=` |
| New | `src/app/config/credit-periods/page.tsx` | Server Component — reads searchParams, fetches list, renders table |
| New | `src/app/config/credit-periods/_components/credit-period-sheet.tsx` | Client Component — create/edit sheet with typeahead |
| New | `src/app/config/credit-periods/_components/credit-period-filters.tsx` | Client Component — filter controls (entity, name, closed toggle, Add button) |
| Edit | `src/app/config/page.tsx` | Credit Periods card: 5-row open-only preview + "Manage →" link in header |

### Data flow

```
/config/credit-periods?entity_code=&party_name_contains=&include_closed=&page=
  └─ page.tsx (Server Component)
       ├─ requirePageRole → currentUser
       ├─ parseCreditPeriodListQuery(searchParams)
       ├─ listCreditPeriods(query, currentUser)          ← existing server function
       ├─ <CreditPeriodFilters currentUser={...} />      ← client, URL-driven
       ├─ table rows + pagination links
       └─ <CreditPeriodSheet canEdit={...} rows={items} canonicalId={?} name={?} />
            ├─ Typeahead: GET /api/parties?name_contains=...  (debounced 300ms, min 2 chars)
            ├─ Create:    POST /api/config/credit-period      → router.refresh()
            └─ Edit:      PATCH /api/config/credit-period/[configId] → router.refresh()
```

---

## B — New API: `GET /api/parties`

### Purpose

Party name typeahead for the create sheet. No existing list/search endpoint for `parties_canonical`.

### Contract

`GET /api/parties?name_contains=<string>&entity_code=<IND|UAE>&page_size=<n>`

- Auth: ANALYST, CFO, REVIEWER, ADMIN
- ANALYST: results scoped to their `entity_id` (same pattern as `listCreditPeriods`)
- `name_contains`: required, min 2 chars, case-insensitive contains on `parties_canonical.name`
- `entity_code`: optional filter
- `page_size`: default 10, max 20
- Response 200: `{ items: [{ id, name, entity_code }] }`
- Response 400: validation error

### Server function

```ts
// src/server/parties/search.ts
export interface PartySearchResult {
  id: string;
  name: string;
  entity_code: "IND" | "UAE";
}

export async function searchParties(
  nameContains: string,
  entityCode: "IND" | "UAE" | undefined,
  pageSize: number,
  currentUser: AuthenticatedUser,
): Promise<PartySearchResult[]>
// Queries parties_canonical; ANALYST filter: entity_id = currentUser.entityIdScope
```

---

## C — Subpage: `/config/credit-periods`

### Filters (client component, URL-driven)

| Control | URL param | Notes |
|---------|-----------|-------|
| Entity select | `entity_code` | `All \| IND \| UAE`; ANALYST sees only their entity (locked) |
| Party name input | `party_name_contains` | Debounced 300ms push to URL |
| Show closed toggle | `include_closed` | Off by default; shows rows with `valid_to IS NOT NULL` |
| Add Credit Period button | — | ANALYST + ADMIN only; opens sheet in create mode |

Filter changes reset `page` to 1.

### Table columns

| Column | Notes |
|--------|-------|
| Party | Linked to `/party/[id]` |
| Entity | IND / UAE badge |
| Days | Integer |
| Valid From | YYYY-MM-DD |
| Valid To | "—" for open rows; date for closed |
| Reason | Truncated note or "—" |
| Actions | "Edit" button — open rows only, ADMIN only |

Closed rows render with muted text. No delete action (405 by design — rows are versioned).

Pagination: prev/next links updating `page` in URL; "Page N of M · X rows total" label.

### `/config` summary card changes

- Remove `.slice(0, 5)` — replace with `listCreditPeriods({ include_closed: false, page: 1, page_size: 5 }, currentUser)` (open rows only, `valid_from` desc)
- Add "Manage →" link in `<CardHeader>` next to `<CardTitle>` (visible to all roles)

---

## D — Create/Edit Sheet

### Create mode (ANALYST + ADMIN)

Opened by "Add Credit Period" button, or pre-populated when URL contains `?open=create&canonical_id=xxx&name=Party+Name`.

| Field | Control | Validation |
|-------|---------|------------|
| Party | Typeahead input → locked chip on selection | Required; min 2 chars to trigger search |
| Credit Days | Number input | Required; integer ≥ 0 |
| Valid From | Date input | Required; defaults to today (YYYY-MM-DD) |
| Reason | Textarea | Optional; nullable |

**Overwrite warning:** Once a party is selected, the sheet checks `rows` prop for an existing open row with the same `canonical_id`. If found, shows: *"This will close the current open config (from [valid_from]) and start a new one from [valid_from input]."*

On submit → `POST /api/config/credit-period` with `{ canonical_id, credit_days, valid_from, reason_note }`.

### Edit mode (ADMIN only, open rows only)

Opened by "Edit" button on a table row.

| Field | Control |
|-------|---------|
| Party | Read-only text |
| Valid From | Read-only text |
| Credit Days | Number input (pre-filled) |
| Reason | Textarea (pre-filled) |

On submit → `PATCH /api/config/credit-period/[configId]` with `{ credit_days?, reason_note? }`.

### Shared behaviour

- Success: sheet closes, `router.refresh()` re-fetches the server component
- Error: inline message below the relevant field (API error code → human string mapping)
- Saving state: submit button shows spinner, inputs disabled

---

## E — RBAC Summary

| Action | ANALYST | ADMIN | REVIEWER | CFO |
|--------|---------|-------|----------|-----|
| View list | ✓ (own entity) | ✓ | ✓ | ✓ |
| Create | ✓ | ✓ | — | — |
| Edit open row | — | ✓ | — | — |
| Delete | — | — | — | — |

RBAC enforced at three layers: UI visibility, API route (`requireRole`), service function.

---

## Out of scope

- Delete / close a credit period row from the UI (rows are immutable once closed — a new create supersedes)
- Link from `/party/[id]` page to the create sheet (pre-population query params are implemented server-side but the party page is not modified in this spec)
- Bulk import of credit period configs

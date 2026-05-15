# Credit Days UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an entity-level default credit days editor to `/config`, and surface per-row `no_credit_days` warnings in staging before publish.

**Architecture:** Part B adds a new server module + API route + client card that follows the existing `creditPeriod.ts` → `api/config/credit-period/route.ts` → `config/page.tsx` pattern exactly. Part C extracts a pure `canResolveCreditDays` helper, calls it inside `buildStagingRows` to annotate rows, then propagates the count through `gateFromRows` to the UI filter tab and publish gate blocker.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7, Neon, Tailwind CSS 4, Zod, Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/server/config/entityDefaults.ts` | `listEntityDefaults`, `updateEntityDefault`, audit log |
| Create | `src/app/api/config/entity-defaults/[entityId]/route.ts` | PATCH handler |
| Create | `src/app/config/_components/entity-defaults-card.tsx` | Inline-edit client card |
| Create | `src/server/ageing/credit-days-check.ts` | Pure `canResolveCreditDays` helper |
| Create | `src/server/__tests__/entity-defaults.test.ts` | Unit tests for B |
| Create | `src/server/__tests__/credit-days-check.test.ts` | Unit tests for C helper |
| Create | `src/server/__tests__/staging-credit-days-gate.test.ts` | Source-inspection tests for gate wiring |
| Edit | `src/app/config/page.tsx` | Import + render `EntityDefaultsCard` |
| Edit | `src/components/ui/status-tag-map.ts` | Add `NO_CREDIT_DAYS` tag |
| Edit | `src/server/snapshots/service.ts` | Types + `buildStagingRows` + `gateFromRows` + schema + filter |
| Edit | `src/app/snapshots/[snapshotId]/staging/_components/staging-data-table.tsx` | Tab + badge |
| Edit | `src/app/snapshots/[snapshotId]/staging/_components/staging-publish-panel.tsx` | Gate blocker item |

---

## Task 1: Server module for entity defaults

**Files:**
- Create: `src/server/config/entityDefaults.ts`
- Create: `src/server/__tests__/entity-defaults.test.ts`

- [ ] **Step 1.1: Write failing tests**

```ts
// src/server/__tests__/entity-defaults.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MODULE = join(
  process.cwd(),
  "src",
  "server",
  "config",
  "entityDefaults.ts",
);

describe("entityDefaults server module", () => {
  it("exports listEntityDefaults", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("export async function listEntityDefaults");
  });

  it("exports updateEntityDefault", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("export async function updateEntityDefault");
  });

  it("enforces ANALYST and ADMIN RBAC in updateEntityDefault", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("role_enum.ANALYST");
    expect(src).toContain("role_enum.ADMIN");
    expect(src).toContain("ForbiddenError");
  });

  it("writes audit_log on update", () => {
    const src = readFileSync(MODULE, "utf8");
    expect(src).toContain("createAuditLog");
    expect(src).toContain("entity_default_credit_days_updated");
  });
});
```

- [ ] **Step 1.2: Run tests to verify they fail**

```bash
cd /Users/teja/Documents/Claude/Projects/receivables_ageing_dashboard
npm test -- --reporter=verbose src/server/__tests__/entity-defaults.test.ts
```

Expected: FAIL — `MODULE` path does not exist.

- [ ] **Step 1.3: Create the server module**

```ts
// src/server/config/entityDefaults.ts
import { role_enum } from "@/generated/prisma/enums";
import { createAuditLog } from "@/server/core/audit";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";

export interface EntityDefaultRow {
  id: string;
  code: string;
  name: string;
  default_credit_days: number | null;
}

export async function listEntityDefaults(
  _currentUser: AuthenticatedUser,
): Promise<EntityDefaultRow[]> {
  const rows = await getPrisma().entities.findMany({
    select: { id: true, code: true, name: true, default_credit_days: true },
    orderBy: { code: "asc" },
  });
  return rows;
}

export async function updateEntityDefault(
  entityId: string,
  defaultCreditDays: number | null,
  currentUser: AuthenticatedUser,
): Promise<EntityDefaultRow> {
  if (
    currentUser.role !== role_enum.ANALYST &&
    currentUser.role !== role_enum.ADMIN
  ) {
    throw new ForbiddenError("Only ANALYST or ADMIN can update entity defaults");
  }

  if (
    defaultCreditDays !== null &&
    (!Number.isInteger(defaultCreditDays) || defaultCreditDays < 0)
  ) {
    throw new HttpError(
      "validation_error",
      422,
      "default_credit_days must be a non-negative integer or null",
    );
  }

  const existing = await getPrisma().entities.findUnique({
    where: { id: entityId },
    select: { id: true, code: true, name: true, default_credit_days: true },
  });
  if (!existing) {
    throw new HttpError("not_found", 404, "Entity not found");
  }

  const updated = await getPrisma().entities.update({
    where: { id: entityId },
    data: { default_credit_days: defaultCreditDays },
    select: { id: true, code: true, name: true, default_credit_days: true },
  });

  await createAuditLog(
    currentUser.id,
    "entity_default_credit_days_updated",
    "entities",
    entityId,
    { default_credit_days: existing.default_credit_days },
    { default_credit_days: updated.default_credit_days },
  );

  return updated;
}
```

- [ ] **Step 1.4: Run tests — expect pass**

```bash
npm test -- --reporter=verbose src/server/__tests__/entity-defaults.test.ts
```

Expected: 4 passing.

- [ ] **Step 1.5: Commit**

```bash
git add src/server/config/entityDefaults.ts src/server/__tests__/entity-defaults.test.ts
git commit -m "feat(config): add entityDefaults server module with RBAC and audit log"
```

---

## Task 2: API route for entity defaults

**Files:**
- Create: `src/app/api/config/entity-defaults/[entityId]/route.ts`

- [ ] **Step 2.1: Create the route**

```ts
// src/app/api/config/entity-defaults/[entityId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { role_enum } from "@/generated/prisma/enums";
import {
  updateEntityDefault,
} from "@/server/config/entityDefaults";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ entityId: string }> },
) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.ADMIN,
    );
    const { entityId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new HttpError("validation_error", 400, "Invalid JSON body");
    }

    const raw = body as Record<string, unknown>;
    const rawDays = raw.default_credit_days;

    let defaultCreditDays: number | null;
    if (rawDays === null || rawDays === undefined) {
      defaultCreditDays = null;
    } else if (typeof rawDays === "number") {
      defaultCreditDays = rawDays;
    } else {
      throw new HttpError(
        "validation_error",
        422,
        "default_credit_days must be a number or null",
      );
    }

    const updated = await updateEntityDefault(
      entityId,
      defaultCreditDays,
      currentUser,
    );
    return NextResponse.json(updated);
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 2.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/app/api/config/entity-defaults/
git commit -m "feat(api): add PATCH /api/config/entity-defaults/[entityId]"
```

---

## Task 3: EntityDefaultsCard client component

**Files:**
- Create: `src/app/config/_components/entity-defaults-card.tsx`

- [ ] **Step 3.1: Create the component**

The card renders a table of entities. Each row has an "Edit" button that reveals an inline number input with Save/Cancel. On Save it PATCHes the route, then calls `onSaved()` which the server page will implement as `router.refresh()`.

```tsx
// src/app/config/_components/entity-defaults-card.tsx
"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { EntityDefaultRow } from "@/server/config/entityDefaults";

type Props = {
  entities: EntityDefaultRow[];
  canEdit: boolean;
};

type RowState =
  | { mode: "view" }
  | { mode: "editing"; draft: string }
  | { mode: "saving" }
  | { mode: "error"; message: string };

export function EntityDefaultsCard({ entities, canEdit }: Props) {
  const [rowStates, setRowStates] = useState<Record<string, RowState>>(
    () => Object.fromEntries(entities.map((e) => [e.id, { mode: "view" }])),
  );
  const [localDefaults, setLocalDefaults] = useState<
    Record<string, number | null>
  >(() =>
    Object.fromEntries(entities.map((e) => [e.id, e.default_credit_days])),
  );

  function startEdit(id: string) {
    const current = localDefaults[id];
    setRowStates((s) => ({
      ...s,
      [id]: { mode: "editing", draft: current === null ? "" : String(current) },
    }));
  }

  function cancelEdit(id: string) {
    setRowStates((s) => ({ ...s, [id]: { mode: "view" } }));
  }

  async function save(id: string) {
    const state = rowStates[id];
    if (state.mode !== "editing") return;

    const draft = state.draft.trim();
    const newValue = draft === "" ? null : Number(draft);

    if (newValue !== null && (!Number.isInteger(newValue) || newValue < 0)) {
      setRowStates((s) => ({
        ...s,
        [id]: { mode: "error", message: "Must be a non-negative whole number" },
      }));
      return;
    }

    setRowStates((s) => ({ ...s, [id]: { mode: "saving" } }));

    try {
      const res = await fetch(`/api/config/entity-defaults/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ default_credit_days: newValue }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(payload?.message ?? `Request failed with ${res.status}`);
      }
      setLocalDefaults((d) => ({ ...d, [id]: newValue }));
      setRowStates((s) => ({ ...s, [id]: { mode: "view" } }));
    } catch (err) {
      setRowStates((s) => ({
        ...s,
        [id]: {
          mode: "error",
          message: err instanceof Error ? err.message : "Save failed",
        },
      }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entity Settings</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full table-auto text-sm">
          <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Default Credit Days</th>
              {canEdit ? <th className="px-3 py-2" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {entities.map((entity) => {
              const state = rowStates[entity.id] ?? { mode: "view" };
              const currentDefault = localDefaults[entity.id];

              return (
                <tr key={entity.id}>
                  <td className="px-3 py-2 font-medium">{entity.code}</td>
                  <td className="px-3 py-2">
                    {state.mode === "editing" || state.mode === "error" ? (
                      <div className="flex flex-col gap-1">
                        <input
                          autoFocus
                          className="w-24 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                          min={0}
                          onChange={(e) =>
                            setRowStates((s) => ({
                              ...s,
                              [entity.id]: {
                                mode: "editing",
                                draft: e.target.value,
                              },
                            }))
                          }
                          placeholder="e.g. 30"
                          type="number"
                          value={
                            state.mode === "editing" ? state.draft : ""
                          }
                        />
                        {state.mode === "error" ? (
                          <p className="text-xs text-[var(--color-status-danger-text)]">
                            {state.message}
                          </p>
                        ) : null}
                      </div>
                    ) : state.mode === "saving" ? (
                      <span className="text-[var(--color-text-muted)]">
                        Saving…
                      </span>
                    ) : currentDefault === null ? (
                      <span className="text-[var(--color-text-muted)]">—</span>
                    ) : (
                      <span className="tabular-nums">{currentDefault} days</span>
                    )}
                  </td>
                  {canEdit ? (
                    <td className="px-3 py-2">
                      {state.mode === "view" ? (
                        <button
                          className="text-xs text-[var(--color-accent)] hover:underline"
                          onClick={() => startEdit(entity.id)}
                          type="button"
                        >
                          Edit
                        </button>
                      ) : state.mode === "editing" ||
                        state.mode === "error" ? (
                        <div className="flex gap-2">
                          <button
                            className="text-xs text-[var(--color-accent)] hover:underline"
                            onClick={() => save(entity.id)}
                            type="button"
                          >
                            Save
                          </button>
                          <button
                            className="text-xs text-[var(--color-text-muted)] hover:underline"
                            onClick={() => cancelEdit(entity.id)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/app/config/_components/entity-defaults-card.tsx
git commit -m "feat(config): add EntityDefaultsCard inline-edit client component"
```

---

## Task 4: Wire EntityDefaultsCard into /config page

**Files:**
- Modify: `src/app/config/page.tsx`

- [ ] **Step 4.1: Add imports and call to config page**

In `src/app/config/page.tsx`, after the existing imports add:

```ts
import { listEntityDefaults } from "@/server/config/entityDefaults";
import { EntityDefaultsCard } from "./_components/entity-defaults-card";
```

Inside `ConfigPage()`, after the existing data fetches, add:

```ts
const entityDefaults = await listEntityDefaults(currentUser);
```

At the bottom of the JSX (after the FX Rates `<Card>`), add:

```tsx
<EntityDefaultsCard
  canEdit={
    currentUser.role === role_enum.ANALYST ||
    currentUser.role === role_enum.ADMIN
  }
  entities={entityDefaults}
/>
```

- [ ] **Step 4.2: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/app/config/page.tsx
git commit -m "feat(config): render EntityDefaultsCard on /config page"
```

---

## Task 5: Add NO_CREDIT_DAYS status tag

**Files:**
- Modify: `src/components/ui/status-tag-map.ts`

- [ ] **Step 5.1: Add the tag**

In `src/components/ui/status-tag-map.ts`, inside `STATUS_TAGS`, after the `PARSE_ERROR` line add:

```ts
  NO_CREDIT_DAYS: tag("No Credit Days", "danger"),
```

- [ ] **Step 5.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/components/ui/status-tag-map.ts
git commit -m "feat(ui): add NO_CREDIT_DAYS status tag (danger tone)"
```

---

## Task 6: Pure credit-days resolvability helper

**Files:**
- Create: `src/server/ageing/credit-days-check.ts`
- Create: `src/server/__tests__/credit-days-check.test.ts`

- [ ] **Step 6.1: Write failing tests**

```ts
// src/server/__tests__/credit-days-check.test.ts
import { describe, expect, it } from "vitest";
import { canResolveCreditDays } from "@/server/ageing/credit-days-check";

const CONFIG_OPEN = {
  canonical_id: "aaa",
  valid_from: new Date("2025-01-01"),
  valid_to: null,
};

const CONFIG_CLOSED = {
  canonical_id: "aaa",
  valid_from: new Date("2025-01-01"),
  valid_to: new Date("2025-06-30"),
};

describe("canResolveCreditDays", () => {
  it("returns true when credit_days_override is set", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: 30,
        entityDefaultDays: null,
        configs: [],
      }),
    ).toBe(true);
  });

  it("returns true when a matching open config exists", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_OPEN],
      }),
    ).toBe(true);
  });

  it("returns true when a matching closed config covers the invoice date", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2025-03-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_CLOSED],
      }),
    ).toBe(true);
  });

  it("returns false when closed config does not cover the invoice date", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2025-07-01"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_CLOSED],
      }),
    ).toBe(false);
  });

  it("returns true when no config but entityDefaultDays is set", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: 30,
        configs: [],
      }),
    ).toBe(true);
  });

  it("returns false when no config, no default, no override", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "aaa",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [],
      }),
    ).toBe(false);
  });

  it("ignores configs for a different canonical_id", () => {
    expect(
      canResolveCreditDays({
        canonicalId: "bbb",
        invoiceDate: new Date("2026-01-15"),
        creditDaysOverride: null,
        entityDefaultDays: null,
        configs: [CONFIG_OPEN],
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 6.2: Run — expect fail**

```bash
npm test -- --reporter=verbose src/server/__tests__/credit-days-check.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 6.3: Create the helper**

```ts
// src/server/ageing/credit-days-check.ts
type CreditPeriodConfigSlim = {
  canonical_id: string;
  valid_from: Date;
  valid_to: Date | null;
};

export function canResolveCreditDays(params: {
  canonicalId: string;
  invoiceDate: Date;
  creditDaysOverride: number | null;
  entityDefaultDays: number | null;
  configs: CreditPeriodConfigSlim[];
}): boolean {
  if (params.creditDaysOverride !== null) return true;

  const hasConfig = params.configs.some(
    (c) =>
      c.canonical_id === params.canonicalId &&
      c.valid_from <= params.invoiceDate &&
      (c.valid_to === null || c.valid_to >= params.invoiceDate),
  );
  if (hasConfig) return true;

  if (params.entityDefaultDays !== null) return true;

  return false;
}
```

- [ ] **Step 6.4: Run — expect pass**

```bash
npm test -- --reporter=verbose src/server/__tests__/credit-days-check.test.ts
```

Expected: 7 passing.

- [ ] **Step 6.5: Commit**

```bash
git add src/server/ageing/credit-days-check.ts src/server/__tests__/credit-days-check.test.ts
git commit -m "feat(ageing): add pure canResolveCreditDays helper with tests"
```

---

## Task 7: Extend service types and schema

**Files:**
- Modify: `src/server/snapshots/service.ts`

This task makes four targeted edits to `service.ts`. Each edit is surgical — match exactly on the shown old string.

- [ ] **Step 7.1: Add `no_credit_days` to `StagingInvoiceRow`**

Find the `StagingInvoiceRow` interface (around line 222). After the `raw_row_json` field, add:

```ts
  no_credit_days: boolean;
```

The full tail of the interface will look like:

```ts
  xero_metadata: Record<string, unknown> | null;
  raw_row_json: Record<string, unknown>;
  no_credit_days: boolean;
}
```

- [ ] **Step 7.2: Add `credit_days_missing_count` to `PublishGate`**

Find the `PublishGate` interface (around line 206). After the `review_status` line, add:

```ts
  credit_days_missing_count: number;
```

- [ ] **Step 7.3: Add `"no_credit_days"` to `stagingQuerySchema` filter enum**

Find (around line 73):

```ts
    .enum(["all", "ok", "parse_error", "unmapped", "fuzzy_low", "fuzzy_high"])
```

Replace with:

```ts
    .enum(["all", "ok", "parse_error", "unmapped", "fuzzy_low", "fuzzy_high", "no_credit_days"])
```

- [ ] **Step 7.4: Typecheck to confirm types compile**

```bash
npm run typecheck
```

Expected: errors about `no_credit_days` and `credit_days_missing_count` not being initialised — this is expected since `buildStagingRows` and `gateFromRows` haven't been updated yet. Continue to the next task.

---

## Task 8: Wire `canResolveCreditDays` into `buildStagingRows` and `gateFromRows`

**Files:**
- Modify: `src/server/snapshots/service.ts`

- [ ] **Step 8.1: Add import**

At the top of `service.ts`, alongside the other imports, add:

```ts
import { canResolveCreditDays } from "@/server/ageing/credit-days-check";
```

- [ ] **Step 8.2: Extend the parallel prefetch to fetch `default_credit_days`**

Find (around line 1305):

```ts
  const [parties, entityForGate] = await Promise.all([
    loadAliasCorpus(snapshot.entity_id),
    getPrisma().entities.findUnique({
      where: { id: snapshot.entity_id },
      select: { require_review_before_publish: true },
    }),
  ]);
```

Replace with:

```ts
  const [parties, entityForGate] = await Promise.all([
    loadAliasCorpus(snapshot.entity_id),
    getPrisma().entities.findUnique({
      where: { id: snapshot.entity_id },
      select: { require_review_before_publish: true, default_credit_days: true },
    }),
  ]);
```

- [ ] **Step 8.3: Pre-fetch credit_period_configs after invoiceRows is built**

Find the line (around line 1352) that reads `};` ending the `invoiceRows` map, followed by the `const creditRows` declaration. Insert the following block between them:

```ts
  // Pre-fetch credit_period_config rows for all resolved canonical IDs so we
  // can flag rows that would fail resolveCreditDays at publish time.
  const resolvedCanonicalIds = [
    ...new Set(
      invoiceRows
        .filter((r) => r.status === "OK")
        .map(
          (r) =>
            r.analyst_overrides.resolved_canonical_id ??
            (r.alias_resolution.resolutionState === "EXACT"
              ? r.alias_resolution.topMatches[0]?.canonicalId
              : null),
        )
        .filter((id): id is string => id !== null),
    ),
  ];

  const creditPeriodConfigs =
    resolvedCanonicalIds.length > 0
      ? await getPrisma().credit_period_config.findMany({
          where: { canonical_id: { in: resolvedCanonicalIds } },
          select: { canonical_id: true, valid_from: true, valid_to: true },
        })
      : [];

  const entityDefaultDays = entityForGate?.default_credit_days ?? null;
```

- [ ] **Step 8.4: Annotate `invoiceRows` with `no_credit_days`**

The `invoiceRows` map currently returns objects without `no_credit_days`. We need a second pass after the config prefetch. Replace the `const invoiceRows` map to capture rows, then annotate them after. 

Find the return statement inside the `invoiceRows` map, which ends with:

```ts
      raw_row_json: row.raw_row_json,
    };
  });
```

Replace those last three lines with:

```ts
      raw_row_json: row.raw_row_json,
      no_credit_days: false, // annotated below after credit config prefetch
    };
  });
```

Then, after the `const creditPeriodConfigs` block you inserted in Step 8.3, add:

```ts
  // Annotate each OK invoice row with whether credit days can be resolved.
  for (const row of invoiceRows) {
    if (row.status !== "OK") continue;
    const canonicalId =
      row.analyst_overrides.resolved_canonical_id ??
      (row.alias_resolution.resolutionState === "EXACT"
        ? row.alias_resolution.topMatches[0]?.canonicalId
        : null);
    if (!canonicalId) continue; // unmapped/fuzzy — already gated elsewhere
    const invoiceDate = parseDateInput(row.invoice_date);
    if (!invoiceDate) continue;
    row.no_credit_days = !canResolveCreditDays({
      canonicalId,
      invoiceDate,
      creditDaysOverride: row.analyst_overrides.credit_days_override,
      entityDefaultDays,
      configs: creditPeriodConfigs,
    });
  }
```

- [ ] **Step 8.5: Update `gateFromRows` to compute and expose `credit_days_missing_count`**

Find the `return {` block in `gateFromRows` (around line 983):

```ts
  return {
    ok:
      rolePermits &&
      unacknowledged.length === 0 &&
      parseErrorsUnresolved === 0 &&
      unmapped === 0 &&
      fuzzyHigh === 0 &&
      fuzzyLow === 0 &&
      !reviewBlocks,
    unmapped_parties_count: unmapped,
    fuzzy_high_pending_count: fuzzyHigh,
    fuzzy_low_pending_count: fuzzyLow,
    parse_errors_unresolved_count: parseErrorsUnresolved,
    warnings_unacknowledged: unacknowledged,
    role_permits_publish: rolePermits,
    review_status: reviewStatus,
  };
```

Replace with:

```ts
  const creditDaysMissing = invoiceRows.filter((r) => r.no_credit_days).length;

  return {
    ok:
      rolePermits &&
      unacknowledged.length === 0 &&
      parseErrorsUnresolved === 0 &&
      unmapped === 0 &&
      fuzzyHigh === 0 &&
      fuzzyLow === 0 &&
      creditDaysMissing === 0 &&
      !reviewBlocks,
    unmapped_parties_count: unmapped,
    fuzzy_high_pending_count: fuzzyHigh,
    fuzzy_low_pending_count: fuzzyLow,
    parse_errors_unresolved_count: parseErrorsUnresolved,
    credit_days_missing_count: creditDaysMissing,
    warnings_unacknowledged: unacknowledged,
    role_permits_publish: rolePermits,
    review_status: reviewStatus,
  };
```

- [ ] **Step 8.6: Update `filterStagingRows` to handle `"no_credit_days"`**

Find the `filterStagingRows` function (around line 1398). Add a new branch after the `fuzzy_high` branch:

```ts
  if (filter === "no_credit_days") {
    return rows.filter(
      (row): row is StagingInvoiceRow =>
        "no_credit_days" in row && (row as StagingInvoiceRow).no_credit_days,
    );
  }
```

- [ ] **Step 8.7: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 8.8: Write and run source-inspection tests**

```ts
// src/server/__tests__/staging-credit-days-gate.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SERVICE = join(
  process.cwd(),
  "src",
  "server",
  "snapshots",
  "service.ts",
);

describe("staging credit_days_missing gate", () => {
  it("StagingInvoiceRow has no_credit_days field", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain("no_credit_days: boolean");
  });

  it("PublishGate has credit_days_missing_count field", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain(
      "credit_days_missing_count: number",
    );
  });

  it("gate ok predicate includes credit_days_missing_count === 0", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain(
      "creditDaysMissing === 0",
    );
  });

  it("filter schema includes no_credit_days variant", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain('"no_credit_days"');
  });

  it("calls canResolveCreditDays", () => {
    expect(readFileSync(SERVICE, "utf8")).toContain("canResolveCreditDays");
  });
});
```

```bash
npm test -- --reporter=verbose src/server/__tests__/staging-credit-days-gate.test.ts
```

Expected: 5 passing.

- [ ] **Step 8.9: Commit**

```bash
git add src/server/snapshots/service.ts src/server/__tests__/staging-credit-days-gate.test.ts
git commit -m "feat(staging): annotate invoice rows with no_credit_days and block publish gate"
```

---

## Task 9: Staging data table — filter tab and row badge

**Files:**
- Modify: `src/app/snapshots/[snapshotId]/staging/_components/staging-data-table.tsx`

- [ ] **Step 9.1: Add the filter tab**

Find `FILTER_TABS` constant:

```ts
const FILTER_TABS = [
  { label: "All", value: "all" },
  { label: "Unmapped", value: "unmapped" },
  { label: "Fuzzy High", value: "fuzzy_high" },
  { label: "Fuzzy Low", value: "fuzzy_low" },
  { label: "Parse Errors", value: "parse_error" },
  { label: "Resolved", value: "ok" },
] as const;
```

Replace with:

```ts
const FILTER_TABS = [
  { label: "All", value: "all" },
  { label: "Unmapped", value: "unmapped" },
  { label: "Fuzzy High", value: "fuzzy_high" },
  { label: "Fuzzy Low", value: "fuzzy_low" },
  { label: "Parse Errors", value: "parse_error" },
  { label: "No Credit Days", value: "no_credit_days" },
  { label: "Resolved", value: "ok" },
] as const;
```

- [ ] **Step 9.2: Wire the tab count**

Find the section inside `SavedViewTabs` that computes `count` per tab:

```ts
          let count: number | null = null;
          if (value === "all") count = totalRows;
          else if (value === "unmapped") count = gate.unmapped_parties_count;
          else if (value === "fuzzy_high") count = gate.fuzzy_high_pending_count;
          else if (value === "fuzzy_low") count = gate.fuzzy_low_pending_count;
          else if (value === "parse_error")
            count = gate.parse_errors_unresolved_count;
```

Replace with:

```ts
          let count: number | null = null;
          if (value === "all") count = totalRows;
          else if (value === "unmapped") count = gate.unmapped_parties_count;
          else if (value === "fuzzy_high") count = gate.fuzzy_high_pending_count;
          else if (value === "fuzzy_low") count = gate.fuzzy_low_pending_count;
          else if (value === "parse_error")
            count = gate.parse_errors_unresolved_count;
          else if (value === "no_credit_days")
            count = gate.credit_days_missing_count;
```

- [ ] **Step 9.3: Add the `NO CREDIT DAYS` badge to the match column**

Find the `"match"` column definition:

```ts
    {
      key: "match",
      header: "Match",
      cell: (row) => <StatusTag status={rowResolutionState(row)} />,
    },
```

Replace with:

```ts
    {
      key: "match",
      header: "Match",
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          <StatusTag status={rowResolutionState(row)} />
          {isInvoiceRow(row) && row.no_credit_days ? (
            <StatusTag status="NO_CREDIT_DAYS" />
          ) : null}
        </div>
      ),
    },
```

- [ ] **Step 9.4: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 9.5: Commit**

```bash
git add src/app/snapshots/[snapshotId]/staging/_components/staging-data-table.tsx
git commit -m "feat(staging): add No Credit Days filter tab and row badge"
```

---

## Task 10: Staging publish panel — gate blocker

**Files:**
- Modify: `src/app/snapshots/[snapshotId]/staging/_components/staging-publish-panel.tsx`

- [ ] **Step 10.1: Add the gate blocker item**

Find the gate blockers section (around line 226):

```tsx
          {gate.parse_errors_unresolved_count > 0 ? (
            <GateBlockerItem>
              {gate.parse_errors_unresolved_count} unreviewed parse{" "}
              {gate.parse_errors_unresolved_count === 1 ? "error" : "errors"}
            </GateBlockerItem>
          ) : null}
```

After that block, add:

```tsx
          {gate.credit_days_missing_count > 0 ? (
            <GateBlockerItem>
              {gate.credit_days_missing_count}{" "}
              {gate.credit_days_missing_count === 1 ? "row" : "rows"} missing
              credit days — set a credit period config or entity default
            </GateBlockerItem>
          ) : null}
```

- [ ] **Step 10.2: Typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 10.3: Commit**

```bash
git add src/app/snapshots/[snapshotId]/staging/_components/staging-publish-panel.tsx
git commit -m "feat(staging): add credit_days_missing gate blocker to publish panel"
```

---

## Task 11: Full verification

- [ ] **Step 11.1: Run all tests**

```bash
npm test
```

Expected: all existing tests pass, new tests pass.

- [ ] **Step 11.2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 11.3: Lint**

```bash
npm run lint
```

Expected: no warnings or errors.

- [ ] **Step 11.4: Build**

```bash
npm run build
```

Expected: successful build with no type errors.

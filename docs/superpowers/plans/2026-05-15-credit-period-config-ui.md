# Credit Period Config UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/config/credit-periods` management page with a full table, URL-driven filters, and a create/edit modal so analysts and admins can manage credit period configs without a direct DB write.

**Architecture:** Server Component page fetches data from the existing `listCreditPeriods` service; a single `CreditPeriodManager` client component owns the sheet (modal) open/close state and filter URL navigation. Backend routes (`POST`, `PATCH`) already exist — only the frontend and one new party-search API endpoint are new.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, Tailwind CSS 4, Vitest (source-inspection tests).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/server/parties/search.ts` | `searchParties()` — scoped party name search |
| Create | `src/app/api/parties/route.ts` | `GET /api/parties?name_contains=&entity_code=&page_size=` |
| Create | `src/server/__tests__/parties-search.test.ts` | Source-inspection tests for searchParties |
| Create | `src/app/api/parties/__tests__/route.test.ts` | Source-inspection tests for the API route |
| Create | `src/app/config/credit-periods/page.tsx` | Server Component — reads searchParams, fetches, renders CreditPeriodManager |
| Create | `src/app/config/credit-periods/_components/credit-period-manager.tsx` | Client Component — table, filters, pagination, sheet open state |
| Create | `src/app/config/credit-periods/_components/credit-period-sheet.tsx` | Client Component — create/edit modal form with typeahead |
| Create | `src/app/config/credit-periods/_components/__tests__/credit-period-sheet.test.ts` | Source-inspection tests for the sheet |
| Modify | `src/app/config/page.tsx` | Credit Periods card: fetch 5 open rows + "Manage →" link |

---

### Task 1: `searchParties` server function

**Files:**
- Create: `src/server/parties/search.ts`
- Create: `src/server/__tests__/parties-search.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/parties-search.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("searchParties", () => {
  const src = readFileSync(
    resolve(__dirname, "../parties/search.ts"),
    "utf-8",
  );

  it("scopes ANALYST to their entity_id", () => {
    expect(src).toContain("where.entity_id = currentUser.entityIdScope");
  });

  it("throws when ANALYST has no entityIdScope", () => {
    expect(src).toContain("Analyst user has no entity scope");
  });

  it("filters by name contains case-insensitive", () => {
    expect(src).toContain('mode: "insensitive"');
  });

  it("filters by entity_code when provided", () => {
    expect(src).toContain("where.entities = { code: entityCode }");
  });

  it("limits results by pageSize", () => {
    expect(src).toContain("take: pageSize");
  });

  it("orders results by name asc", () => {
    expect(src).toContain('orderBy: { name: "asc" }');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/__tests__/parties-search.test.ts --reporter verbose
```

Expected: 6 failures — file does not exist yet.

- [ ] **Step 3: Create `src/server/parties/search.ts`**

```ts
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { role_enum } from "@/generated/prisma/enums";
import { HttpError } from "@/server/core/errors";
import type { AuthenticatedUser } from "@/server/core/auth";

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
): Promise<PartySearchResult[]> {
  const prisma = getPrisma();

  const where: Prisma.parties_canonicalWhereInput = {
    name: { contains: nameContains, mode: "insensitive" },
  };

  if (currentUser.role === role_enum.ANALYST) {
    if (!currentUser.entityIdScope) {
      throw new HttpError("forbidden", 403, "Analyst user has no entity scope");
    }
    where.entity_id = currentUser.entityIdScope;
  }

  if (entityCode) {
    where.entities = { code: entityCode };
  }

  const rows = await prisma.parties_canonical.findMany({
    where,
    orderBy: { name: "asc" },
    take: pageSize,
    select: {
      id: true,
      name: true,
      entities: { select: { code: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    entity_code: r.entities.code as "IND" | "UAE",
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/__tests__/parties-search.test.ts --reporter verbose
```

Expected: 6 passed.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/parties/search.ts src/server/__tests__/parties-search.test.ts
git commit -m "feat(parties): add searchParties server function with ANALYST scope"
```

---

### Task 2: `GET /api/parties` route

**Files:**
- Create: `src/app/api/parties/route.ts`
- Create: `src/app/api/parties/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/parties/__tests__/route.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("GET /api/parties", () => {
  const src = readFileSync(resolve(__dirname, "../route.ts"), "utf-8");

  it("exports force-dynamic", () => {
    expect(src).toContain('dynamic = "force-dynamic"');
  });

  it("requires at least ANALYST role", () => {
    expect(src).toContain("role_enum.ANALYST");
    expect(src).toContain("role_enum.CFO");
    expect(src).toContain("role_enum.REVIEWER");
    expect(src).toContain("role_enum.ADMIN");
  });

  it("validates name_contains with min length 2", () => {
    expect(src).toContain("min(2");
  });

  it("caps page_size at 20", () => {
    expect(src).toContain("max(20)");
  });

  it("calls searchParties", () => {
    expect(src).toContain("searchParties");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run "src/app/api/parties/__tests__/route.test.ts" --reporter verbose
```

Expected: 5 failures.

- [ ] **Step 3: Create `src/app/api/parties/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import { HttpError, toErrorResponse } from "@/server/core/errors";
import { searchParties } from "@/server/parties/search";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  name_contains: z
    .string()
    .min(2, "name_contains must be at least 2 characters"),
  entity_code: z.enum(["IND", "UAE"]).optional(),
  page_size: z.coerce.number().int().min(1).max(20).default(10),
});

export async function GET(request: NextRequest) {
  try {
    const currentUser = await requireRole(
      role_enum.ANALYST,
      role_enum.CFO,
      role_enum.REVIEWER,
      role_enum.ADMIN,
    );

    const params = Object.fromEntries(
      request.nextUrl.searchParams.entries(),
    );
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) {
      throw new HttpError(
        "validation_error",
        400,
        parsed.error.issues[0]?.message ?? "Invalid query parameters",
      );
    }

    const items = await searchParties(
      parsed.data.name_contains,
      parsed.data.entity_code,
      parsed.data.page_size,
      currentUser,
    );

    return NextResponse.json({ items });
  } catch (error) {
    return toErrorResponse(error);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run "src/app/api/parties/__tests__/route.test.ts" --reporter verbose
```

Expected: 5 passed.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/parties/route.ts "src/app/api/parties/__tests__/route.test.ts"
git commit -m "feat(api): add GET /api/parties party name search endpoint"
```

---

### Task 3: `/config/credit-periods` page + `CreditPeriodManager` client component

**Files:**
- Create: `src/app/config/credit-periods/page.tsx`
- Create: `src/app/config/credit-periods/_components/credit-period-manager.tsx`
- Create: `src/app/config/credit-periods/_components/__tests__/credit-period-manager.test.ts`

This task builds the server page and the full client manager (table, filters, pagination). The sheet is stubbed as `null` — it gets wired in Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/config/credit-periods/_components/__tests__/credit-period-manager.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("CreditPeriodManager", () => {
  const src = readFileSync(
    resolve(__dirname, "../credit-period-manager.tsx"),
    "utf-8",
  );

  it("is a client component", () => {
    expect(src).toContain('"use client"');
  });

  it("uses useRouter and useSearchParams for filter navigation", () => {
    expect(src).toContain("useRouter");
    expect(src).toContain("useSearchParams");
  });

  it("resets page param on filter change", () => {
    expect(src).toContain('params.delete("page")');
  });

  it("renders Add button only when canCreate is true", () => {
    expect(src).toContain("canCreate");
    expect(src).toContain("Add Credit Period");
  });

  it("renders Edit button only for open rows when canEdit is true", () => {
    expect(src).toContain("canEdit");
    expect(src).toContain("valid_to");
  });

  it("hides entity filter when hideEntityFilter is true", () => {
    expect(src).toContain("hideEntityFilter");
  });
});

describe("CreditPeriodsPage", () => {
  const src = readFileSync(
    resolve(__dirname, "../../page.tsx"),
    "utf-8",
  );

  it("is force-dynamic", () => {
    expect(src).toContain('dynamic = "force-dynamic"');
  });

  it("requires page role", () => {
    expect(src).toContain("requirePageRole");
  });

  it("passes canCreate for ANALYST and ADMIN", () => {
    expect(src).toContain("role_enum.ANALYST");
    expect(src).toContain("role_enum.ADMIN");
    expect(src).toContain("canCreate");
  });

  it("passes canEdit for ADMIN only", () => {
    expect(src).toContain("canEdit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run "src/app/config/credit-periods/_components/__tests__/credit-period-manager.test.ts" --reporter verbose
```

Expected: failures (files don't exist yet).

- [ ] **Step 3: Create the directory structure**

```bash
mkdir -p src/app/config/credit-periods/_components/__tests__
```

- [ ] **Step 4: Create `src/app/config/credit-periods/_components/credit-period-manager.tsx`**

```tsx
"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { CreditPeriodRow } from "@/server/config/creditPeriod";

type SheetState =
  | { mode: "closed" }
  | { mode: "create"; canonicalId?: string; canonicalName?: string }
  | { mode: "edit"; row: CreditPeriodRow };

type Pagination = {
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
};

type Props = {
  items: CreditPeriodRow[];
  pagination: Pagination;
  canCreate: boolean;
  canEdit: boolean;
  hideEntityFilter: boolean;
  initialSheet?: "create" | "edit";
  initialConfigId?: string;
  initialCanonicalId?: string;
  initialCanonicalName?: string;
};

export function CreditPeriodManager({
  items,
  pagination,
  canCreate,
  canEdit,
  hideEntityFilter,
  initialSheet,
  initialConfigId,
  initialCanonicalId,
  initialCanonicalName,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sheet, setSheet] = useState<SheetState>(() => {
    if (initialSheet === "create") {
      return {
        mode: "create",
        canonicalId: initialCanonicalId,
        canonicalName: initialCanonicalName,
      };
    }
    if (initialSheet === "edit" && initialConfigId) {
      const row = items.find((r) => r.id === initialConfigId);
      if (row) return { mode: "edit", row };
    }
    return { mode: "closed" };
  });

  const updateFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete("page");
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const closeSheet = useCallback(() => setSheet({ mode: "closed" }), []);

  const onSuccess = useCallback(() => {
    setSheet({ mode: "closed" });
    router.refresh();
  }, [router]);

  function pageHref(page: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    return `${pathname}?${params.toString()}`;
  }

  const existingOpenRows = items.filter((r) => r.valid_to === null);

  return (
    <>
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {!hideEntityFilter && (
          <select
            value={searchParams.get("entity_code") ?? ""}
            onChange={(e) => updateFilter("entity_code", e.target.value)}
            className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          >
            <option value="">All entities</option>
            <option value="IND">IND</option>
            <option value="UAE">UAE</option>
          </select>
        )}

        <input
          key={searchParams.get("party_name_contains") ?? ""}
          type="text"
          placeholder="Search party…"
          defaultValue={searchParams.get("party_name_contains") ?? ""}
          className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] px-2 text-sm text-[var(--color-text)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              updateFilter(
                "party_name_contains",
                (e.target as HTMLInputElement).value,
              );
            }
          }}
          onBlur={(e) => updateFilter("party_name_contains", e.target.value)}
        />

        <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
          <input
            type="checkbox"
            checked={searchParams.get("include_closed") === "true"}
            onChange={(e) =>
              updateFilter("include_closed", e.target.checked ? "true" : "")
            }
          />
          Show closed
        </label>

        {canCreate && (
          <button
            className="ml-auto rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            onClick={() => setSheet({ mode: "create" })}
            type="button"
          >
            + Add Credit Period
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full table-auto text-sm">
          <thead className="bg-[var(--color-bg-muted)] text-left text-xs uppercase text-[var(--color-text-muted)]">
            <tr>
              <th className="px-3 py-2">Party</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Valid From</th>
              <th className="px-3 py-2">Valid To</th>
              <th className="px-3 py-2">Reason</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {items.length === 0 ? (
              <tr>
                <td
                  className="px-3 py-6 text-center text-[var(--color-text-muted)]"
                  colSpan={canEdit ? 7 : 6}
                >
                  No credit periods found.
                </td>
              </tr>
            ) : (
              items.map((row) => {
                const isClosed = row.valid_to !== null;
                return (
                  <tr
                    key={row.id}
                    className={
                      isClosed ? "text-[var(--color-text-muted)]" : ""
                    }
                  >
                    <td className="px-3 py-2">
                      <Link
                        className="text-[var(--color-accent)] hover:underline"
                        href={`/party/${row.canonical_id}`}
                      >
                        {row.canonical_name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.entity_code}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.credit_days}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{row.valid_from}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.valid_to ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.reason_note ? (
                        <span
                          className="block max-w-[200px] truncate"
                          title={row.reason_note}
                        >
                          {row.reason_note}
                        </span>
                      ) : (
                        <span className="text-[var(--color-text-subtle)]">
                          —
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-2">
                        {!isClosed && (
                          <button
                            className="text-xs text-[var(--color-accent)] hover:underline"
                            onClick={() => setSheet({ mode: "edit", row })}
                            type="button"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="flex items-center justify-between text-sm text-[var(--color-text-muted)]">
          <span>
            Page {pagination.page} of {pagination.total_pages} ·{" "}
            {pagination.total} rows
          </span>
          <div className="flex gap-3">
            {pagination.page > 1 && (
              <Link
                className="text-[var(--color-accent)] hover:underline"
                href={pageHref(pagination.page - 1)}
              >
                ← Prev
              </Link>
            )}
            {pagination.page < pagination.total_pages && (
              <Link
                className="text-[var(--color-accent)] hover:underline"
                href={pageHref(pagination.page + 1)}
              >
                Next →
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Sheet placeholder — replaced in Task 4 */}
      {sheet.mode !== "closed" && null}

      {/* Keep these used so TypeScript doesn't complain */}
      {void existingOpenRows}
      {void closeSheet}
      {void onSuccess}
    </>
  );
}
```

- [ ] **Step 5: Create `src/app/config/credit-periods/page.tsx`**

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { role_enum } from "@/generated/prisma/enums";
import { requirePageRole } from "@/server/core/page-auth";
import {
  listCreditPeriods,
  parseCreditPeriodListQuery,
} from "@/server/config/creditPeriod";
import { CreditPeriodManager } from "./_components/credit-period-manager";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CreditPeriodsPage({
  searchParams,
}: PageProps) {
  const currentUser = await requirePageRole(
    "/config/credit-periods",
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );

  const params = await searchParams;

  const query = parseCreditPeriodListQuery({
    entity_code: first(params.entity_code),
    party_name_contains: first(params.party_name_contains),
    include_closed: first(params.include_closed),
    page: first(params.page),
    page_size: "50",
  });

  const result = await listCreditPeriods(query, currentUser);

  const canCreate =
    currentUser.role === role_enum.ANALYST ||
    currentUser.role === role_enum.ADMIN;
  const canEdit = currentUser.role === role_enum.ADMIN;
  const hideEntityFilter = currentUser.role === role_enum.ANALYST;

  return (
    <div className="min-h-screen bg-[var(--color-bg-subtle)] p-6 text-[var(--color-text)]">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Credit Periods</h1>
          <Link
            className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            href="/config"
          >
            ← Back to Config
          </Link>
        </div>

        <Suspense
          fallback={
            <p className="text-sm text-[var(--color-text-muted)]">
              Loading…
            </p>
          }
        >
          <CreditPeriodManager
            canCreate={canCreate}
            canEdit={canEdit}
            hideEntityFilter={hideEntityFilter}
            initialCanonicalId={first(params.canonical_id)}
            initialCanonicalName={first(params.name)}
            initialConfigId={first(params.config_id)}
            initialSheet={
              first(params.sheet) as "create" | "edit" | undefined
            }
            items={result.items}
            pagination={result.pagination}
          />
        </Suspense>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the test**

```bash
npx vitest run "src/app/config/credit-periods/_components/__tests__/credit-period-manager.test.ts" --reporter verbose
```

Expected: all pass.

- [ ] **Step 7: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors (the `void` statements in the stub are intentional).

- [ ] **Step 8: Commit**

```bash
git add src/app/config/credit-periods/
git commit -m "feat(config): add /config/credit-periods page and CreditPeriodManager (table + filters)"
```

---

### Task 4: `CreditPeriodSheet` modal + wire into manager

**Files:**
- Create: `src/app/config/credit-periods/_components/credit-period-sheet.tsx`
- Create: `src/app/config/credit-periods/_components/__tests__/credit-period-sheet.test.ts`
- Modify: `src/app/config/credit-periods/_components/credit-period-manager.tsx` (remove stub, import sheet)

- [ ] **Step 1: Write the failing test**

```ts
// src/app/config/credit-periods/_components/__tests__/credit-period-sheet.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("CreditPeriodSheet", () => {
  const src = readFileSync(
    resolve(__dirname, "../credit-period-sheet.tsx"),
    "utf-8",
  );

  it("is a client component", () => {
    expect(src).toContain('"use client"');
  });

  it("uses the fixed inset-0 modal overlay pattern", () => {
    expect(src).toContain("fixed inset-0");
    expect(src).toContain('role="dialog"');
    expect(src).toContain('aria-modal="true"');
  });

  it("debounces typeahead by 300ms", () => {
    expect(src).toContain("300");
    expect(src).toContain("setTimeout");
  });

  it("requires min 2 chars before fetching suggestions", () => {
    expect(src).toContain("length < 2");
  });

  it("shows overwrite warning for existing open config", () => {
    expect(src).toContain(
      "This will close the current open config",
    );
  });

  it("POSTs to create endpoint in create mode", () => {
    expect(src).toContain('"/api/config/credit-period"');
    expect(src).toContain('"POST"');
  });

  it("PATCHes to update endpoint in edit mode", () => {
    expect(src).toContain("credit-period/${row");
    expect(src).toContain('"PATCH"');
  });

  it("calls onSuccess after successful submit", () => {
    expect(src).toContain("onSuccess()");
  });

  it("calls onClose when backdrop is clicked", () => {
    expect(src).toContain("onClose()");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run "src/app/config/credit-periods/_components/__tests__/credit-period-sheet.test.ts" --reporter verbose
```

Expected: all failures.

- [ ] **Step 3: Create `src/app/config/credit-periods/_components/credit-period-sheet.tsx`**

```tsx
"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { SidePanel } from "@/components/ui/side-panel";
import type { CreditPeriodRow } from "@/server/config/creditPeriod";
import type { PartySearchResult } from "@/server/parties/search";

type Props = {
  mode: "create" | "edit";
  row?: CreditPeriodRow;
  initialCanonicalId?: string;
  initialCanonicalName?: string;
  existingOpenRows: CreditPeriodRow[];
  onClose: () => void;
  onSuccess: () => void;
};

export function CreditPeriodSheet({
  mode,
  row,
  initialCanonicalId,
  initialCanonicalName,
  existingOpenRows,
  onClose,
  onSuccess,
}: Props) {
  // Typeahead
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PartySearchResult[]>([]);
  const [typeaheadLoading, setTypeaheadLoading] = useState(false);
  const [selectedParty, setSelectedParty] =
    useState<PartySearchResult | null>(
      initialCanonicalId && initialCanonicalName
        ? {
            id: initialCanonicalId,
            name: initialCanonicalName,
            entity_code: "IND" as const,
          }
        : null,
    );
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Form fields
  const [creditDays, setCreditDays] = useState(
    mode === "edit" && row ? String(row.credit_days) : "",
  );
  const [validFrom, setValidFrom] = useState(
    mode === "edit" && row
      ? row.valid_from
      : new Date().toISOString().slice(0, 10),
  );
  const [reasonNote, setReasonNote] = useState(
    mode === "edit" && row ? (row.reason_note ?? "") : "",
  );

  // Submit state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced typeahead fetch
  useEffect(() => {
    if (query.length < 2) {
      setSuggestions([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setTypeaheadLoading(true);
      const params = new URLSearchParams({
        name_contains: query,
        page_size: "10",
      });
      fetch(`/api/parties?${params.toString()}`)
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((data: { items: PartySearchResult[] }) => {
          setSuggestions(data.items);
        })
        .catch(() => {
          setSuggestions([]);
        })
        .finally(() => {
          setTypeaheadLoading(false);
        });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const clearParty = useCallback(() => {
    setSelectedParty(null);
    setQuery("");
    setSuggestions([]);
  }, []);

  const existingOpen = selectedParty
    ? existingOpenRows.find((r) => r.canonical_id === selectedParty.id)
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const days = parseInt(creditDays, 10);
    if (!Number.isInteger(days) || days < 0) {
      setError("Credit days must be a non-negative whole number.");
      return;
    }

    if (mode === "create" && !selectedParty) {
      setError("Please select a party.");
      return;
    }

    setSaving(true);
    try {
      let res: Response;
      if (mode === "create") {
        res = await fetch("/api/config/credit-period", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canonical_id: selectedParty!.id,
            credit_days: days,
            valid_from: validFrom,
            reason_note: reasonNote.trim() || null,
          }),
        });
      } else {
        res = await fetch(`/api/config/credit-period/${row!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credit_days: days,
            reason_note: reasonNote.trim() || null,
          }),
        });
      }

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(
          payload?.message ?? `Request failed (${res.status})`,
        );
      }
      onSuccess();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Save failed. Please retry.",
      );
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/20 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        className="w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-period-sheet-title"
      >
        <SidePanel
          className="shadow-xl"
          title={
            <span id="credit-period-sheet-title">
              {mode === "create" ? "Add Credit Period" : "Edit Credit Period"}
            </span>
          }
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            {/* Party field */}
            {mode === "create" ? (
              <div>
                <p className="text-xs font-medium text-[var(--color-text-muted)]">
                  Party <span className="text-red-500">*</span>
                </p>
                {selectedParty ? (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg-muted)] px-3 py-2 text-sm">
                      {selectedParty.name}
                      <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                        ({selectedParty.entity_code})
                      </span>
                    </span>
                    <button
                      className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                      onClick={clearParty}
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="relative mt-1">
                    <input
                      autoFocus
                      className="h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Type party name…"
                      type="text"
                      value={query}
                    />
                    {(suggestions.length > 0 || typeaheadLoading) && (
                      <ul className="absolute z-10 mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg">
                        {typeaheadLoading ? (
                          <li className="px-3 py-2 text-sm text-[var(--color-text-muted)]">
                            Loading…
                          </li>
                        ) : (
                          suggestions.map((s) => (
                            <li key={s.id}>
                              <button
                                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--color-bg-muted)]"
                                onClick={() => {
                                  setSelectedParty(s);
                                  setQuery("");
                                  setSuggestions([]);
                                }}
                                type="button"
                              >
                                <span className="flex-1">{s.name}</span>
                                <span className="text-xs text-[var(--color-text-muted)]">
                                  {s.entity_code}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                )}
                {existingOpen && (
                  <p className="mt-1 text-xs text-[var(--color-status-warning-text)]">
                    ⚠ This will close the current open config (from{" "}
                    {existingOpen.valid_from}) and start a new one.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">
                    Party
                  </p>
                  <p className="mt-0.5 text-sm">
                    {row!.canonical_name}
                    <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                      ({row!.entity_code})
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-[var(--color-text-muted)]">
                    Valid From
                  </p>
                  <p className="mt-0.5 text-sm tabular-nums">{row!.valid_from}</p>
                </div>
              </div>
            )}

            {/* Credit Days */}
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                Credit Days <span className="text-red-500">*</span>
              </span>
              <input
                className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                disabled={saving}
                min={0}
                onChange={(e) => setCreditDays(e.target.value)}
                placeholder="e.g. 30"
                required
                type="number"
                value={creditDays}
              />
            </label>

            {/* Valid From (create only) */}
            {mode === "create" && (
              <label className="block">
                <span className="text-xs font-medium text-[var(--color-text-muted)]">
                  Valid From <span className="text-red-500">*</span>
                </span>
                <input
                  className="mt-1 h-10 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                  disabled={saving}
                  onChange={(e) => setValidFrom(e.target.value)}
                  required
                  type="date"
                  value={validFrom}
                />
              </label>
            )}

            {/* Reason */}
            <label className="block">
              <span className="text-xs font-medium text-[var(--color-text-muted)]">
                Reason (optional)
              </span>
              <textarea
                className="mt-1 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                disabled={saving}
                onChange={(e) => setReasonNote(e.target.value)}
                placeholder="e.g. Special arrangement signed 2024-01-15"
                rows={2}
                value={reasonNote}
              />
            </label>

            {/* Error */}
            {error && (
              <p className="text-xs text-[var(--color-status-danger-text)]">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-[var(--radius-sm)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? "Saving…"
                  : mode === "create"
                    ? "Add"
                    : "Save Changes"}
              </button>
              <button
                className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-50"
                disabled={saving}
                onClick={onClose}
                type="button"
              >
                Cancel
              </button>
            </div>
          </form>
        </SidePanel>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the sheet test**

```bash
npx vitest run "src/app/config/credit-periods/_components/__tests__/credit-period-sheet.test.ts" --reporter verbose
```

Expected: all pass.

- [ ] **Step 5: Wire sheet into `credit-period-manager.tsx`**

Replace the stub section at the bottom of `credit-period-manager.tsx`. Remove these lines:

```tsx
      {/* Sheet placeholder — replaced in Task 4 */}
      {sheet.mode !== "closed" && null}

      {/* Keep these used so TypeScript doesn't complain */}
      {void existingOpenRows}
      {void closeSheet}
      {void onSuccess}
```

Add the import at the top of the file (after the existing imports):

```tsx
import { CreditPeriodSheet } from "./credit-period-sheet";
```

Replace the stub with the real sheet render:

```tsx
      {/* Sheet */}
      {sheet.mode !== "closed" && (
        <CreditPeriodSheet
          existingOpenRows={existingOpenRows}
          initialCanonicalId={
            sheet.mode === "create" ? sheet.canonicalId : undefined
          }
          initialCanonicalName={
            sheet.mode === "create" ? sheet.canonicalName : undefined
          }
          mode={sheet.mode}
          onClose={closeSheet}
          onSuccess={onSuccess}
          row={sheet.mode === "edit" ? sheet.row : undefined}
        />
      )}
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run "src/app/config/credit-periods" --reporter verbose
```

Expected: all pass.

- [ ] **Step 7: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/config/credit-periods/
git commit -m "feat(config): add CreditPeriodSheet modal and wire into manager"
```

---

### Task 5: Update `/config` summary card

**Files:**
- Modify: `src/app/config/page.tsx` (lines 24–27 and 37–71)

- [ ] **Step 1: Write the failing test**

```ts
// src/server/__tests__/credit-period-config-summary.test.ts
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("/config page Credit Periods card", () => {
  const src = readFileSync(
    resolve(__dirname, "../../app/config/page.tsx"),
    "utf-8",
  );

  it("fetches with page_size of 5", () => {
    expect(src).toContain('page_size: "5"');
  });

  it("does not slice the array", () => {
    expect(src).not.toContain(".slice(0, 5)");
  });

  it("renders a Manage link pointing to /config/credit-periods", () => {
    expect(src).toContain("/config/credit-periods");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/server/__tests__/credit-period-config-summary.test.ts --reporter verbose
```

Expected: 3 failures (no `page_size: "5"`, has `.slice(0, 5)`, no `/config/credit-periods` link).

- [ ] **Step 3: Edit `src/app/config/page.tsx`**

Change the credit periods fetch (around line 24):

```tsx
  const creditPeriods = await listCreditPeriods(
    parseCreditPeriodListQuery({ page_size: "5" }),
    currentUser,
  );
```

Change the Credit Periods card header (around line 37–40) to add the Manage link. Replace:

```tsx
        <Card>
          <CardHeader>
            <CardTitle>Credit Periods</CardTitle>
          </CardHeader>
```

With:

```tsx
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Credit Periods</CardTitle>
              <Link
                className="text-sm text-[var(--color-accent)] hover:underline"
                href="/config/credit-periods"
              >
                Manage →
              </Link>
            </div>
          </CardHeader>
```

Remove `.slice(0, 5)` from the table body (around line 58):

```tsx
                  {creditPeriods.items.map((row) => (
```

(was: `{creditPeriods.items.slice(0, 5).map((row) => (`)

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/server/__tests__/credit-period-config-summary.test.ts --reporter verbose
```

Expected: 3 passed.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all previously passing tests still pass + new tests pass.

- [ ] **Step 6: Typecheck, lint, build**

```bash
npm run typecheck && npm run lint && npm run build
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/config/page.tsx src/server/__tests__/credit-period-config-summary.test.ts
git commit -m "feat(config): add Manage link and fix credit period summary card"
```

---

## Self-Review

**Spec coverage:**
- ✅ A — `searchParties` + `GET /api/parties` (Tasks 1, 2)
- ✅ B — `/config/credit-periods` page with server-rendered table (Task 3)
- ✅ C — URL-driven filters: entity, party name, include_closed (Task 3)
- ✅ D — Create/Edit sheet with typeahead, overwrite warning, RBAC-gated buttons (Tasks 3, 4)
- ✅ E — RBAC: canCreate (ANALYST+ADMIN), canEdit (ADMIN), hideEntityFilter (ANALYST) (Task 3)
- ✅ `/config` summary card: 5-row open-only preview + Manage link (Task 5)

**Placeholder scan:** None.

**Type consistency:**
- `CreditPeriodRow` used consistently from `@/server/config/creditPeriod`
- `PartySearchResult` defined in `src/server/parties/search.ts` and imported by the sheet
- `SheetState` union type is local to `credit-period-manager.tsx` and covers all branches

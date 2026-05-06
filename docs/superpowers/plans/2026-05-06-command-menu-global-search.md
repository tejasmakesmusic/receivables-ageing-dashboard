# Command Menu Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a role-scoped command menu for fast navigation and approved actions without leaking cross-entity invoice, party, or task data.

**Architecture:** Start with a server-side search contract and typed DTOs, then add a client command palette over that contract. The first shippable version exposes navigation and existing audited routes only; it must not create new mutation paths outside current route handlers.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, Tailwind CSS 4, Vitest, existing RBAC helpers.

---

## Gate Before Implementation

The search contract must be approved before any command-menu UI is implemented. Approval must cover result groups, minimum query length, entity scoping, CFO read-only behavior, and which actions are allowed from the menu.

---

### Task 1: Search Contract

**Files:**
- Create: `src/server/search/contract.ts`
- Create: `src/server/__tests__/command-search-contract.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Create tests that assert the contract exposes only these result groups:

```ts
import { describe, expect, it } from "vitest";
import {
  COMMAND_SEARCH_GROUPS,
  COMMAND_SEARCH_MIN_QUERY_LENGTH,
  COMMAND_SEARCH_ACTIONS,
} from "@/server/search/contract";

describe("command search contract", () => {
  it("uses a minimum query length before searching business records", () => {
    expect(COMMAND_SEARCH_MIN_QUERY_LENGTH).toBe(3);
  });

  it("defines the approved result groups", () => {
    expect(COMMAND_SEARCH_GROUPS).toEqual([
      "INVOICE",
      "PARTY",
      "COLLECTION_TASK",
      "PROMISE_TO_PAY",
      "DISPUTE_CASE",
      "NAVIGATION",
    ]);
  });

  it("defines only actions that route through existing audited surfaces", () => {
    expect(COMMAND_SEARCH_ACTIONS).toEqual([
      "OPEN_FOCUS_QUEUE",
      "OPEN_UPLOAD",
      "OPEN_AGEING_EXPORT",
      "OPEN_DIGEST_APPROVAL",
      "OPEN_AUDIT_LOG",
      "OPEN_PROMISE_TO_PAY",
      "OPEN_DISPUTE_CASE",
    ]);
  });
});
```

Run: `npm test -- src/server/__tests__/command-search-contract.test.ts`
Expected: FAIL because `src/server/search/contract.ts` does not exist.

- [ ] **Step 2: Add the contract constants**

Create `src/server/search/contract.ts`:

```ts
export const COMMAND_SEARCH_MIN_QUERY_LENGTH = 3;

export const COMMAND_SEARCH_GROUPS = [
  "INVOICE",
  "PARTY",
  "COLLECTION_TASK",
  "PROMISE_TO_PAY",
  "DISPUTE_CASE",
  "NAVIGATION",
] as const;

export const COMMAND_SEARCH_ACTIONS = [
  "OPEN_FOCUS_QUEUE",
  "OPEN_UPLOAD",
  "OPEN_AGEING_EXPORT",
  "OPEN_DIGEST_APPROVAL",
  "OPEN_AUDIT_LOG",
  "OPEN_PROMISE_TO_PAY",
  "OPEN_DISPUTE_CASE",
] as const;

export type CommandSearchGroup = (typeof COMMAND_SEARCH_GROUPS)[number];
export type CommandSearchAction = (typeof COMMAND_SEARCH_ACTIONS)[number];
```

Run: `npm test -- src/server/__tests__/command-search-contract.test.ts`
Expected: PASS.

---

### Task 2: Search Service

**Files:**
- Create: `src/server/search/service.ts`
- Create: `src/server/__tests__/command-search-service.test.ts`

- [ ] **Step 1: Write role-scope tests**

Mock Prisma reads and assert:

```ts
import { describe, expect, it, vi } from "vitest";
import { role_enum } from "@/generated/prisma/enums";
import { searchCommandMenu } from "@/server/search/service";

const analyst = {
  id: "user-1",
  email: "analyst@example.com",
  role: role_enum.ANALYST,
  entityIdScope: "entity-ind",
};

describe("searchCommandMenu", () => {
  it("does not query business records below the minimum query length", async () => {
    const prisma = {
      invoices: { findMany: vi.fn() },
      parties_canonical: { findMany: vi.fn() },
      collection_tasks: { findMany: vi.fn() },
      promises_to_pay: { findMany: vi.fn() },
      dispute_cases: { findMany: vi.fn() },
    };

    const results = await searchCommandMenu({ query: "ab" }, analyst, prisma);

    expect(results).toEqual([]);
    expect(prisma.invoices.findMany).not.toHaveBeenCalled();
  });

  it("scopes analyst invoice and party searches to their entity", async () => {
    const prisma = {
      invoices: { findMany: vi.fn().mockResolvedValue([]) },
      parties_canonical: { findMany: vi.fn().mockResolvedValue([]) },
      collection_tasks: { findMany: vi.fn().mockResolvedValue([]) },
      promises_to_pay: { findMany: vi.fn().mockResolvedValue([]) },
      dispute_cases: { findMany: vi.fn().mockResolvedValue([]) },
    };

    await searchCommandMenu({ query: "globex" }, analyst, prisma);

    expect(prisma.invoices.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity_id: "entity-ind" }),
      }),
    );
    expect(prisma.parties_canonical.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entity_id: "entity-ind" }),
      }),
    );
  });
});
```

Run: `npm test -- src/server/__tests__/command-search-service.test.ts`
Expected: FAIL because `search/service.ts` does not exist.

- [ ] **Step 2: Implement read-only DTO results**

Return DTOs with this shape:

```ts
export interface CommandSearchResult {
  group: CommandSearchGroup;
  id: string;
  label: string;
  subtitle: string;
  href: string;
}
```

Use existing RBAC helpers for page access and entity scope. Do not include raw invoice rows, raw parser JSON, notes, or email addresses in the result payload.

Run: `npm test -- src/server/__tests__/command-search-service.test.ts`
Expected: PASS.

---

### Task 3: API Route

**Files:**
- Create: `src/app/api/search/command/route.ts`
- Create: `src/server/__tests__/command-search-route.test.ts`

- [ ] **Step 1: Write validation tests**

Assert the route rejects unauthenticated users, rejects PENDING users, caps `limit` at 10, and returns empty results for short queries.

Run: `npm test -- src/server/__tests__/command-search-route.test.ts`
Expected: FAIL because the route does not exist.

- [ ] **Step 2: Implement GET route**

The route must parse `q` and `limit`, call `searchCommandMenu`, and return:

```json
{
  "items": []
}
```

The route must not perform mutations. CFO users can search and navigate but cannot receive mutation action endpoints.

Run: `npm test -- src/server/__tests__/command-search-route.test.ts`
Expected: PASS.

---

### Task 4: Command Palette UI

**Files:**
- Create: `src/components/command/command-menu.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/components/shell/Sidebar.tsx`

- [ ] **Step 1: Add keyboard and focus behavior tests where practical**

Test that `/` focuses search when the user is not inside an input, and `Ctrl+K` / `Cmd+K` opens the menu.

Run: `npm test -- src/server/__tests__/command-menu-shortcuts.test.ts`
Expected: FAIL because the client component does not exist.

- [ ] **Step 2: Build the client menu**

Use a compact modal with grouped results. Add navigation actions for upload, focus, invoice/party search results, PTP, dispute, ageing export, digest approval, and audit log. Render disabled read-only action text for CFO where an action would mutate data.

Run: `npm run typecheck && npm run lint`
Expected: PASS.

---

### Task 5: Verification

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run complete verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: PASS.

- [ ] **Step 2: Update progress**

Record the command menu as implemented only after the route, scoped search service, keyboard flow, and role behavior are all verified. If the search contract is not approved, record this plan as ready but blocked on approval.

---

## Self-Review

- Spec coverage: The plan covers `/` search focus, `Ctrl+K` / `Cmd+K`, grouped results, role scope, upload, focus, invoice/party/task search, PTP, dispute, ageing export, digest approval, and audit log.
- Leakage control: Analyst searches are entity-scoped, PENDING users are blocked, and CFO receives navigation-only behavior for mutation surfaces.
- Implementation gate: The UI remains blocked until the search contract is approved.

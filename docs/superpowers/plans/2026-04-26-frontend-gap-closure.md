# Frontend Gap Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all frontend gaps: 3 bug fixes, Workspace page, wireframe-parity sweep on 5 pages, 7 redesigned non-wireframed pages, and exception notes UX (edit headline + threaded notes + D2 surfacing).

**Architecture:** FastAPI backend (Python, SQLAlchemy 2, pydantic v2, alembic) + React 18 frontend (Vite, TypeScript, Tailwind, React Query v5). Backend at `backend/src/app/`; frontend at `frontend/src/`. All mutations write an `audit_log` row. RBAC via `require_role` dep.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0, Alembic, pydantic v2, React 18, TypeScript, Tailwind CSS, React Query v5, vitest, React Router v6.

**Run commands:**
- Backend tests: `uv run pytest backend/tests/unit -q` (fast) or `uv run pytest backend/tests/ -q -p no:randomly` (full, needs Neon branch)
- Frontend tests: `cd frontend && npm run test -- --run`
- Lint: `uv run ruff check backend/src backend/tests && uv run ruff format --check backend/src backend/tests`
- Type check: `cd frontend && npm run typecheck`

---

## File map

### New files
- `backend/alembic/versions/0010_exception_notes.py` — migration for `exception_notes` table
- `backend/src/app/db/models/exception_note.py` — SQLAlchemy model
- `backend/src/app/schemas/exception_note.py` — pydantic schemas for notes
- `backend/src/app/services/exception_note_service.py` — list/create note logic
- `backend/tests/integration/test_exception_notes.py` — backend tests for notes
- `frontend/src/pages/WorkspacePage.tsx` — `/snapshots` list page
- `frontend/src/pages/SnapshotInvoicesPage.tsx` — `/snapshots/:id/invoices` sub-route
- `frontend/src/__tests__/WorkspacePage.test.tsx`
- `frontend/src/__tests__/SnapshotInvoicesPage.test.tsx`

### Modified files
- `backend/src/app/schemas/exception.py` — add `outstanding_amount`, `notes_count` to `ExceptionListRow`; add `EDIT_HEADLINE` action to `ExceptionUpdateRequest`
- `backend/src/app/schemas/snapshot.py` — add `uploaded_by_email`, `outstanding_total` to `SnapshotListRow`
- `backend/src/app/services/exception_service.py` — compute `outstanding_amount` aggregate; handle `EDIT_HEADLINE` action
- `backend/src/app/services/snapshot_service.py` — populate `uploaded_by_email`, `outstanding_total`
- `backend/src/app/api/routes/exceptions.py` — add `/exceptions/:id/notes` GET+POST routes
- `backend/src/app/api/routes/admin.py` — add `/admin/canonicals/merge`, `/admin/audit-log/actions`, `/admin/audit-log/actors`, `/admin/email-rules` GET+PATCH
- `backend/src/app/api/routes/invoices.py` — add `/invoices/:id/snapshot-history`
- `backend/src/app/main.py` — register any new routers if needed
- `frontend/src/components/Shell.tsx` — add Workspace + Follow-ups to NAV_LINKS
- `frontend/src/pages/S3CreditPeriodPage.tsx:391` — fix placeholder label
- `frontend/src/pages/D1DashboardPage.tsx:392` — fix broken link
- `frontend/src/pages/S1UploadPage.tsx` — entity toggle + Uploaded by column + PARSING status
- `frontend/src/pages/S2StagingPage.tsx` — credit-source badges + per-warning ack + PARSE_ERROR collapsible
- `frontend/src/pages/D1DashboardPage.tsx` — dual overdue display + KPI sub-lines + WoW delta + columns
- `frontend/src/pages/S5ExceptionsPage.tsx` — bucket ₹ + unconditional banner + explainer + notes panel + edit modal
- `frontend/src/pages/A6ReconciliationPage.tsx` — KPI inline copy + publish-gate banner
- `frontend/src/pages/D2PartyDetailPage.tsx` — KPI row + 3 tabs
- `frontend/src/pages/D3InvoiceDetailPage.tsx` — raw row + snapshot history + related
- `frontend/src/pages/S4AliasesPage.tsx` — confidence badges + merge modal
- `frontend/src/pages/A2EmailOutboxPage.tsx` — human timestamps + resend + email rules
- `frontend/src/pages/A3ExceptionBucketsPage.tsx` — preview column
- `frontend/src/pages/A4FxRatesPage.tsx` — two-pane SVG timeline
- `frontend/src/pages/A5AuditLogPage.tsx` — dropdown filters + diff modal
- `frontend/src/App.tsx` — add `/snapshots` and `/snapshots/:id/invoices` routes

---

## Phase 1 — Bug fixes

### Task 1: Fix S3 duplicate IND dropdown option

**Files:**
- Modify: `frontend/src/pages/S3CreditPeriodPage.tsx:391`
- Test: `frontend/src/__tests__/S3CreditPeriodPage.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/__tests__/S3CreditPeriodPage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { S3CreditPeriodPage } from "@/pages/S3CreditPeriodPage";

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
}

vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: () => Promise.resolve({ items: [], total: 0, page: 1, page_size: 25 }),
}));

function Wrapper() {
  return (
    <QueryClientProvider client={makeQC()}>
      <MemoryRouter initialEntries={["/config/credit-period"]}>
        <Routes>
          <Route path="/config/credit-period" element={<S3CreditPeriodPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("S3CreditPeriodPage — entity filter", () => {
  it("default entity select placeholder says All not IND", () => {
    render(<Wrapper />);
    // The second entity select (in 'parties on default CP' section) must have 'All' as first option
    const selects = screen.getAllByRole("combobox");
    const placeholderOptions = selects.map(
      (s) => (s as HTMLSelectElement).options[0].text
    );
    expect(placeholderOptions).not.toContain("IND");
    expect(placeholderOptions.some((t) => t === "All")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd frontend && npm run test -- --run src/__tests__/S3CreditPeriodPage.test.tsx
```
Expected: FAIL — placeholder text is "IND".

- [ ] **Step 3: Fix the placeholder**

In `frontend/src/pages/S3CreditPeriodPage.tsx` find line 391:
```tsx
<option value="">IND</option>
```
Change to:
```tsx
<option value="">All</option>
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd frontend && npm run test -- --run src/__tests__/S3CreditPeriodPage.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/S3CreditPeriodPage.tsx frontend/src/__tests__/S3CreditPeriodPage.test.tsx
git commit -m "fix(ui): S3 entity filter placeholder IND → All (duplicate dropdown)"
```

---

### Task 2: Fix D1 broken credit-period link

**Files:**
- Modify: `frontend/src/pages/D1DashboardPage.tsx`
- Test: `frontend/src/__tests__/D1DashboardPage.test.tsx` (extend existing or create)

- [ ] **Step 1: Write failing test**

Find the existing test file or create `frontend/src/__tests__/D1DashboardPageLink.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Minimal mock of D1 — just render the banner link
vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
  ok: true, status: 200,
  json: () => Promise.resolve({
    entity: "IND", as_of_date: "2026-04-19",
    kpis: { total_open: 0, overdue_amount: 0, pct_overdue: 0, parties_90_plus: 0, parties_90_plus_amount: 0 },
    ageing_buckets: [], top_parties: [], recent_exceptions: [], trend_snapshots: [],
    default_credit_days: 30, snapshot_id: "snap-001",
  }),
}));

import { D1DashboardPage } from "@/pages/D1DashboardPage";

function Wrapper() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/dashboard?entity=IND"]}>
        <Routes>
          <Route path="/dashboard" element={<D1DashboardPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("D1 credit period link", () => {
  it("links to /config/credit-period not /credit-period", async () => {
    render(<Wrapper />);
    // Wait for data + find any anchor with credit-period
    await new Promise((r) => setTimeout(r, 50));
    const links = document.querySelectorAll('a[href*="credit-period"]');
    links.forEach((l) => {
      expect(l.getAttribute("href")).toBe("/config/credit-period");
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd frontend && npm run test -- --run src/__tests__/D1DashboardPageLink.test.tsx
```
Expected: FAIL — link points to `/credit-period`.

- [ ] **Step 3: Fix the link**

In `frontend/src/pages/D1DashboardPage.tsx` near line 392, find:
```tsx
to="/credit-period"
```
Replace with:
```tsx
to="/config/credit-period"
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd frontend && npm run test -- --run src/__tests__/D1DashboardPageLink.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/D1DashboardPage.tsx frontend/src/__tests__/D1DashboardPageLink.test.tsx
git commit -m "fix(ui): D1 default-CP banner link /credit-period → /config/credit-period"
```

---

### Task 3: Add Workspace + Follow-ups to Shell nav

**Files:**
- Modify: `frontend/src/components/Shell.tsx`
- Test: `frontend/src/__tests__/Shell.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/__tests__/Shell.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Shell } from "@/components/Shell";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ data: { role: "ANALYST", email: "t@emb.global" }, isLoading: false }),
}));

function Wrapper() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Shell><div>content</div></Shell>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Shell nav links", () => {
  it("shows Workspace link for ANALYST", () => {
    render(<Wrapper />);
    expect(screen.getByRole("link", { name: /workspace/i })).toBeInTheDocument();
  });

  it("shows Follow-ups link for ANALYST", () => {
    render(<Wrapper />);
    expect(screen.getByRole("link", { name: /follow.ups/i })).toBeInTheDocument();
  });

  it("Workspace link points to /snapshots", () => {
    render(<Wrapper />);
    expect(screen.getByRole("link", { name: /workspace/i })).toHaveAttribute("href", "/snapshots");
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd frontend && npm run test -- --run src/__tests__/Shell.test.tsx
```
Expected: FAIL — links not found.

- [ ] **Step 3: Add entries to NAV_LINKS**

In `frontend/src/components/Shell.tsx`, find the `NAV_LINKS` (or equivalent nav array). Add the two entries in this order: Workspace between Upload and Dashboard; Follow-ups between Exceptions and Admin:

```tsx
// Before (approximate existing structure):
const NAV_LINKS = [
  { to: "/upload", label: "Upload", roles: ["ANALYST", "ADMIN"] },
  { to: "/dashboard", label: "Dashboard", roles: ["ANALYST", "CFO", "ADMIN"] },
  // ...
  { to: "/exceptions", label: "Exceptions", roles: ["ANALYST", "CFO", "ADMIN"] },
  // admin links...
];

// After:
const NAV_LINKS = [
  { to: "/upload", label: "Upload", roles: ["ANALYST", "ADMIN"] },
  { to: "/snapshots", label: "Workspace", roles: ["ANALYST", "CFO", "ADMIN"] },
  { to: "/dashboard", label: "Dashboard", roles: ["ANALYST", "CFO", "ADMIN"] },
  // ...
  { to: "/exceptions", label: "Exceptions", roles: ["ANALYST", "CFO", "ADMIN"] },
  { to: "/follow-ups", label: "Follow-ups", roles: ["ANALYST", "ADMIN"] },
  // admin links...
];
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd frontend && npm run test -- --run src/__tests__/Shell.test.tsx
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Shell.tsx frontend/src/__tests__/Shell.test.tsx
git commit -m "fix(nav): add Workspace and Follow-ups to sidebar NAV_LINKS"
```

---

## Phase 2 — Backend additions

### Task 4: Snapshot schema enrichment (uploaded_by_email + outstanding_total)

**Files:**
- Modify: `backend/src/app/schemas/snapshot.py`
- Modify: `backend/src/app/services/snapshot_service.py`
- Test: `backend/tests/integration/test_snapshots_list_detail.py`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/integration/test_snapshots_list_detail.py`:

```python
def test_snapshot_list_includes_uploaded_by_email_and_outstanding_total(
    client, analyst_headers, published_ind_snapshot  # use existing fixtures
):
    resp = client.get("/snapshots", headers=analyst_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) > 0
    row = items[0]
    assert "uploaded_by_email" in row
    assert isinstance(row["uploaded_by_email"], str)
    assert "outstanding_total" in row
    # outstanding_total is None for non-PUBLISHED or a number for PUBLISHED
    assert row["outstanding_total"] is None or isinstance(row["outstanding_total"], (int, float))
```

- [ ] **Step 2: Run to confirm fail**

```bash
uv run pytest backend/tests/integration/test_snapshots_list_detail.py::test_snapshot_list_includes_uploaded_by_email_and_outstanding_total -xvs
```
Expected: FAIL — `uploaded_by_email` not in response.

- [ ] **Step 3: Add fields to schema**

In `backend/src/app/schemas/snapshot.py`, find `SnapshotListRow` and add:

```python
class SnapshotListRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    entity_code: str
    source_hint: str
    status: str
    as_of_date: date
    row_count: int | None
    created_at: datetime
    uploaded_by_email: str | None = None   # ADD
    outstanding_total: Decimal | None = None  # ADD
```

Add `from decimal import Decimal` to imports if not present.

- [ ] **Step 4: Populate in service**

In `backend/src/app/services/snapshot_service.py`, in the function that queries snapshots for the list endpoint, join to `users` and compute the aggregate. Find the query (look for `Snapshot` model query returning list) and extend:

```python
from decimal import Decimal
from sqlalchemy import func, select
from app.db.models.snapshot import Snapshot
from app.db.models.user import User
from app.db.models.invoice_snapshot import InvoiceSnapshot

def list_snapshots(db: Session, entity_code: str | None, ...) -> SnapshotListResponse:
    # existing query building...
    # After fetching `rows: list[Snapshot]`, build response with extra fields:
    result = []
    for snap in rows:
        # uploaded_by_email via relationship or separate query
        email = snap.created_by.email if snap.created_by else None
        # outstanding_total for PUBLISHED snapshots
        if snap.status == "PUBLISHED":
            total = db.scalar(
                select(func.sum(InvoiceSnapshot.outstanding_amount)).where(
                    InvoiceSnapshot.snapshot_id == snap.id
                )
            )
        else:
            total = None
        result.append(
            SnapshotListRow(
                **{
                    k: getattr(snap, k)
                    for k in ["id", "entity_code", "source_hint", "status",
                               "as_of_date", "row_count", "created_at"]
                },
                uploaded_by_email=email,
                outstanding_total=Decimal(str(total)) if total else None,
            )
        )
    # return wrapped in existing response schema
```

Adapt to the actual shape of the existing service — the key is joining `created_by` and summing `InvoiceSnapshot.outstanding_amount`.

- [ ] **Step 5: Run to confirm pass**

```bash
uv run pytest backend/tests/integration/test_snapshots_list_detail.py::test_snapshot_list_includes_uploaded_by_email_and_outstanding_total -xvs
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/schemas/snapshot.py backend/src/app/services/snapshot_service.py backend/tests/integration/test_snapshots_list_detail.py
git commit -m "feat(snapshot): add uploaded_by_email + outstanding_total to SnapshotListRow"
```

---

### Task 5: ExceptionListRow outstanding_amount + notes_count

**Files:**
- Modify: `backend/src/app/schemas/exception.py`
- Modify: `backend/src/app/services/exception_service.py`
- Test: `backend/tests/integration/test_exceptions_crud.py`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/integration/test_exceptions_crud.py`:

```python
def test_exception_list_row_has_outstanding_amount(client, analyst_headers, open_exception):
    resp = client.get("/exceptions", headers=analyst_headers)
    assert resp.status_code == 200
    items = resp.json()["items"]
    assert len(items) > 0
    row = items[0]
    assert "outstanding_amount" in row
    assert "notes_count" in row
    assert isinstance(row["notes_count"], int)
```

- [ ] **Step 2: Run to confirm fail**

```bash
uv run pytest backend/tests/integration/test_exceptions_crud.py::test_exception_list_row_has_outstanding_amount -xvs
```
Expected: FAIL.

- [ ] **Step 3: Add fields to ExceptionListRow**

In `backend/src/app/schemas/exception.py`:

```python
from decimal import Decimal

class ExceptionListRow(BaseModel):
    model_config = ConfigDict(frozen=True)
    # ... existing fields ...
    outstanding_amount: Decimal | None = None   # ADD
    notes_count: int = 0                         # ADD
```

- [ ] **Step 4: Compute in service**

In `backend/src/app/services/exception_service.py`, in `list_exceptions`, for each tag compute:

```python
from sqlalchemy import func, select
from app.db.models.invoice_snapshot import InvoiceSnapshot
from app.db.models.exception_note import ExceptionNote  # will exist after Task 6

# Per exception tag, after fetching tags:
for tag in tags:
    # outstanding_amount: latest invoice_snapshot.outstanding_amount for this invoice
    outstanding = db.scalar(
        select(InvoiceSnapshot.outstanding_amount)
        .where(InvoiceSnapshot.invoice_id == tag.invoice_id)
        .order_by(InvoiceSnapshot.snapshot_id.desc())
        .limit(1)
    )
    # notes_count: count rows in exception_notes for this tag
    # Note: ExceptionNote model added in Task 6. Guard with try/except ImportError
    # during parallel development, or run Task 6 first.
    notes_count = db.scalar(
        select(func.count()).where(ExceptionNote.exception_tag_id == tag.id)
    ) or 0
    result.append(ExceptionListRow(
        # ...existing fields...,
        outstanding_amount=outstanding,
        notes_count=notes_count,
    ))
```

**Important:** Task 6 (ExceptionNote model) must be committed before this runs cleanly on a Neon branch. For unit tests using mocks, add a try/except ImportError fallback:

```python
try:
    from app.db.models.exception_note import ExceptionNote
    _has_notes_model = True
except ImportError:
    _has_notes_model = False
```

- [ ] **Step 5: Run to confirm pass**

```bash
uv run pytest backend/tests/integration/test_exceptions_crud.py::test_exception_list_row_has_outstanding_amount -xvs
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/app/schemas/exception.py backend/src/app/services/exception_service.py backend/tests/integration/test_exceptions_crud.py
git commit -m "feat(exceptions): add outstanding_amount + notes_count to ExceptionListRow"
```

---

### Task 6: ExceptionNote model + migration 0010

**Files:**
- Create: `backend/src/app/db/models/exception_note.py`
- Create: `backend/alembic/versions/0010_exception_notes.py`
- Modify: `backend/src/app/db/models/__init__.py`
- Test: `backend/tests/integration/test_exception_notes.py`

- [ ] **Step 1: Create the model**

```python
# backend/src/app/db/models/exception_note.py
"""ExceptionNote — immutable chronological note on an exception tag."""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class ExceptionNote(Base):
    __tablename__ = "exception_notes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    exception_tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exception_tags.id", ondelete="CASCADE"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author_user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        nullable=False, server_default=func.now()
    )

    # relationships (lazy=False would N+1 — keep default lazy)
    exception_tag: Mapped["ExceptionTag"] = relationship(back_populates="notes")  # type: ignore[name-defined]
    author: Mapped["User"] = relationship()  # type: ignore[name-defined]
```

- [ ] **Step 2: Register in models __init__**

In `backend/src/app/db/models/__init__.py`, add:
```python
from app.db.models.exception_note import ExceptionNote  # noqa: F401
```

- [ ] **Step 3: Add back-ref on ExceptionTag**

In `backend/src/app/db/models/exception_tag.py`, add to `ExceptionTag` class:
```python
from sqlalchemy.orm import relationship
# inside class:
notes: Mapped[list["ExceptionNote"]] = relationship(
    "ExceptionNote", back_populates="exception_tag", cascade="all, delete-orphan",
    order_by="ExceptionNote.created_at"
)
```

- [ ] **Step 4: Write the Alembic migration**

```bash
uv run alembic -c backend/alembic.ini revision -m "exception_notes"
```

This generates a new file in `backend/alembic/versions/`. Rename it to `0010_exception_notes.py` and edit it:

```python
"""exception_notes — add exception_notes table for threaded discussion."""
from __future__ import annotations
import uuid
import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"  # replace with actual 0009 revision id
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "exception_notes",
        sa.Column("id", sa.UUID(), nullable=False, default=uuid.uuid4),
        sa.Column("exception_tag_id", sa.UUID(), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_user_id", sa.UUID(), nullable=False),
        sa.Column(
            "created_at", sa.TIMESTAMP(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["exception_tag_id"], ["exception_tags.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["author_user_id"], ["users.id"]),
    )
    op.create_index("ix_exception_notes_exception_tag_id", "exception_notes", ["exception_tag_id"])


def downgrade() -> None:
    op.drop_index("ix_exception_notes_exception_tag_id", "exception_notes")
    op.drop_table("exception_notes")
```

**Get the actual `down_revision`:**
```bash
uv run alembic -c backend/alembic.ini history | head -3
```
Use the revision id of `0009_email_outbox_weekly_default_cp_nudge`.

- [ ] **Step 5: Write test skeleton**

```python
# backend/tests/integration/test_exception_notes.py
"""Tests for exception notes endpoints."""
import pytest


def test_exception_notes_list_empty(client, analyst_headers, open_exception):
    """GET /exceptions/:id/notes returns empty list initially."""
    exception_id = open_exception["id"]
    resp = client.get(f"/exceptions/{exception_id}/notes", headers=analyst_headers)
    assert resp.status_code == 200
    assert resp.json() == []


def test_exception_notes_create(client, analyst_headers, open_exception):
    """POST /exceptions/:id/notes creates a note."""
    exception_id = open_exception["id"]
    resp = client.post(
        f"/exceptions/{exception_id}/notes",
        json={"body": "AP team confirmed payment en route"},
        headers=analyst_headers,
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["body"] == "AP team confirmed payment en route"
    assert "id" in data
    assert "created_at" in data
    assert "author_email" in data


def test_exception_notes_create_validates_empty_body(client, analyst_headers, open_exception):
    exception_id = open_exception["id"]
    resp = client.post(
        f"/exceptions/{exception_id}/notes",
        json={"body": "   "},
        headers=analyst_headers,
    )
    assert resp.status_code == 422


def test_exception_notes_cfo_cannot_create(client, cfo_headers, open_exception):
    exception_id = open_exception["id"]
    resp = client.post(
        f"/exceptions/{exception_id}/notes",
        json={"body": "CFO should not write"},
        headers=cfo_headers,
    )
    assert resp.status_code == 403


def test_exception_notes_ordered_oldest_first(client, analyst_headers, open_exception):
    eid = open_exception["id"]
    client.post(f"/exceptions/{eid}/notes", json={"body": "first"}, headers=analyst_headers)
    client.post(f"/exceptions/{eid}/notes", json={"body": "second"}, headers=analyst_headers)
    resp = client.get(f"/exceptions/{eid}/notes", headers=analyst_headers)
    notes = resp.json()
    assert notes[0]["body"] == "first"
    assert notes[1]["body"] == "second"
```

- [ ] **Step 6: Run migration locally and test migrations parse**

```bash
uv run alembic -c backend/alembic.ini upgrade head
uv run pytest backend/tests/unit/test_migrations.py -xvs
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/app/db/models/exception_note.py backend/src/app/db/models/__init__.py backend/src/app/db/models/exception_tag.py backend/alembic/versions/0010_exception_notes.py backend/tests/integration/test_exception_notes.py
git commit -m "feat(db): ExceptionNote model + migration 0010 for threaded exception notes"
```

---

### Task 7: Exception note pydantic schemas

**Files:**
- Create: `backend/src/app/schemas/exception_note.py`
- Modify: `backend/src/app/schemas/exception.py` — add `EDIT_HEADLINE` action

- [ ] **Step 1: Create schema file**

```python
# backend/src/app/schemas/exception_note.py
"""Pydantic schemas for exception notes."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class ExceptionNoteCreateRequest(BaseModel):
    body: str

    @field_validator("body")
    @classmethod
    def body_not_blank(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("body must not be blank")
        if len(v) > 5000:
            raise ValueError("body must be at most 5000 characters")
        return v


class ExceptionNoteRow(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: UUID
    exception_tag_id: UUID
    body: str
    author_email: str
    created_at: datetime
```

- [ ] **Step 2: Extend ExceptionUpdateRequest with EDIT_HEADLINE**

In `backend/src/app/schemas/exception.py`, change `ExceptionUpdateRequest`:

```python
class ExceptionUpdateRequest(BaseModel):
    action: Literal["RESOLVE", "UPDATE_NOTE", "UPDATE_EXPECTED_RESOLUTION_DATE", "EDIT_HEADLINE"]
    resolution_note: str | None = None
    note: str | None = None
    expected_resolution_date: date | None = None
    reason: str | None = None  # ADD — used by EDIT_HEADLINE

    @field_validator("reason")
    @classmethod
    def reason_not_blank_if_provided(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("reason must not be blank")
        return v
```

- [ ] **Step 3: Write unit test for schema validation**

```python
# backend/tests/unit/test_exception_note_schemas.py
import pytest
from pydantic import ValidationError
from app.schemas.exception_note import ExceptionNoteCreateRequest
from app.schemas.exception import ExceptionUpdateRequest


def test_note_body_cannot_be_blank():
    with pytest.raises(ValidationError, match="blank"):
        ExceptionNoteCreateRequest(body="   ")


def test_note_body_max_5000():
    with pytest.raises(ValidationError):
        ExceptionNoteCreateRequest(body="x" * 5001)


def test_note_body_valid():
    req = ExceptionNoteCreateRequest(body="Valid note")
    assert req.body == "Valid note"


def test_edit_headline_action_accepted():
    req = ExceptionUpdateRequest(action="EDIT_HEADLINE", reason="Updated reason")
    assert req.action == "EDIT_HEADLINE"


def test_edit_headline_blank_reason_rejected():
    with pytest.raises(ValidationError, match="blank"):
        ExceptionUpdateRequest(action="EDIT_HEADLINE", reason="  ")
```

- [ ] **Step 4: Run unit tests**

```bash
uv run pytest backend/tests/unit/test_exception_note_schemas.py -xvs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/schemas/exception_note.py backend/src/app/schemas/exception.py backend/tests/unit/test_exception_note_schemas.py
git commit -m "feat(schemas): ExceptionNoteCreateRequest + ExceptionNoteRow + EDIT_HEADLINE action"
```

---

### Task 8: Exception note service + endpoints

**Files:**
- Create: `backend/src/app/services/exception_note_service.py`
- Modify: `backend/src/app/api/routes/exceptions.py`

- [ ] **Step 1: Create service**

```python
# backend/src/app/services/exception_note_service.py
"""Service functions for exception notes."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.audit_log import AuditLog
from app.db.models.exception_note import ExceptionNote
from app.db.models.exception_tag import ExceptionTag
from app.db.models.user import User
from app.schemas.exception_note import ExceptionNoteCreateRequest, ExceptionNoteRow

log = structlog.get_logger()


def list_notes(exception_id: uuid.UUID, db: Session) -> list[ExceptionNoteRow]:
    tag = db.get(ExceptionTag, exception_id)
    if tag is None:
        raise HTTPException(status_code=404, detail=f"Exception {exception_id} not found.")
    notes = db.scalars(
        select(ExceptionNote)
        .where(ExceptionNote.exception_tag_id == exception_id)
        .order_by(ExceptionNote.created_at.asc())
    ).all()
    return [
        ExceptionNoteRow(
            id=n.id,
            exception_tag_id=n.exception_tag_id,
            body=n.body,
            author_email=n.author.email,
            created_at=n.created_at,
        )
        for n in notes
    ]


def create_note(
    exception_id: uuid.UUID,
    body_req: ExceptionNoteCreateRequest,
    current_user: User,
    db: Session,
) -> ExceptionNoteRow:
    tag = db.get(ExceptionTag, exception_id)
    if tag is None:
        raise HTTPException(status_code=404, detail=f"Exception {exception_id} not found.")

    note = ExceptionNote(
        id=uuid.uuid4(),
        exception_tag_id=exception_id,
        body=body_req.body,
        author_user_id=current_user.id,
        created_at=datetime.now(timezone.utc),
    )
    db.add(note)

    audit = AuditLog(
        id=uuid.uuid4(),
        actor_user_id=current_user.id,
        action="CREATE_EXCEPTION_NOTE",
        target_type="ExceptionNote",
        target_id=str(note.id),
        before_state=None,
        after_state={"exception_tag_id": str(exception_id), "body_len": len(body_req.body)},
        occurred_at=datetime.now(timezone.utc),
    )
    db.add(audit)
    db.commit()
    db.refresh(note)

    log.info("exception_note.created", note_id=str(note.id), exception_id=str(exception_id))
    return ExceptionNoteRow(
        id=note.id,
        exception_tag_id=note.exception_tag_id,
        body=note.body,
        author_email=current_user.email,
        created_at=note.created_at,
    )
```

- [ ] **Step 2: Add routes to exceptions.py**

In `backend/src/app/api/routes/exceptions.py`, add after existing routes:

```python
from app.schemas.exception_note import ExceptionNoteCreateRequest, ExceptionNoteRow
from app.services.exception_note_service import create_note, list_notes


@router.get(
    "/exceptions/{exception_id}/notes",
    response_model=list[ExceptionNoteRow],
    summary="List notes for an exception",
    tags=["exceptions"],
)
def list_exception_notes(
    exception_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    _: Annotated[User, Depends(_read_allowed)] = ...,  # type: ignore[assignment]
) -> list[ExceptionNoteRow]:
    return list_notes(exception_id=exception_id, db=session)


@router.post(
    "/exceptions/{exception_id}/notes",
    response_model=ExceptionNoteRow,
    status_code=201,
    summary="Add a note to an exception",
    tags=["exceptions"],
)
def create_exception_note(
    exception_id: uuid.UUID,
    body: ExceptionNoteCreateRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(_write_allowed)] = ...,  # type: ignore[assignment]
) -> ExceptionNoteRow:
    return create_note(exception_id=exception_id, body_req=body, current_user=current_user, db=session)
```

- [ ] **Step 3: Run integration tests**

```bash
uv run pytest backend/tests/integration/test_exception_notes.py -xvs
```
Expected: all 5 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/src/app/services/exception_note_service.py backend/src/app/api/routes/exceptions.py
git commit -m "feat(api): GET+POST /exceptions/:id/notes — threaded exception notes"
```

---

### Task 9: EDIT_HEADLINE action on PATCH /exceptions/:id

**Files:**
- Modify: `backend/src/app/services/exception_service.py`
- Test: `backend/tests/integration/test_exceptions_crud.py`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/integration/test_exceptions_crud.py`:

```python
def test_edit_headline_updates_reason(client, analyst_headers, open_exception):
    eid = open_exception["id"]
    resp = client.patch(
        f"/exceptions/{eid}",
        json={"action": "EDIT_HEADLINE", "reason": "Updated reason after review"},
        headers=analyst_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["action_applied"] == "EDIT_HEADLINE"

    # Verify the list reflects the new reason
    list_resp = client.get("/exceptions", headers=analyst_headers)
    updated = next(e for e in list_resp.json()["items"] if e["id"] == eid)
    assert updated["reason"] == "Updated reason after review"


def test_edit_headline_cannot_blank_reason(client, analyst_headers, open_exception):
    eid = open_exception["id"]
    resp = client.patch(
        f"/exceptions/{eid}",
        json={"action": "EDIT_HEADLINE", "reason": "   "},
        headers=analyst_headers,
    )
    assert resp.status_code == 422


def test_edit_headline_writes_audit_log(client, analyst_headers, open_exception, db_session):
    from app.db.models.audit_log import AuditLog
    from sqlalchemy import select
    eid = open_exception["id"]
    client.patch(f"/exceptions/{eid}", json={"action": "EDIT_HEADLINE", "reason": "new"}, headers=analyst_headers)
    log = db_session.scalar(
        select(AuditLog).where(AuditLog.action == "EDIT_EXCEPTION_HEADLINE").order_by(AuditLog.occurred_at.desc())
    )
    assert log is not None
    assert log.before_state is not None
```

- [ ] **Step 2: Run to confirm fail**

```bash
uv run pytest backend/tests/integration/test_exceptions_crud.py::test_edit_headline_updates_reason -xvs
```
Expected: FAIL — `EDIT_HEADLINE` not handled.

- [ ] **Step 3: Handle EDIT_HEADLINE in update_exception service**

In `backend/src/app/services/exception_service.py`, inside `update_exception`, add handling after existing action checks:

```python
elif body.action == "EDIT_HEADLINE":
    before_state = {"reason": tag.reason, "note": tag.note,
                    "expected_resolution_date": str(tag.expected_resolution_date)}
    if body.reason is not None:
        tag.reason = body.reason
    if body.note is not None:
        tag.note = body.note
    if body.expected_resolution_date is not None:
        tag.expected_resolution_date = body.expected_resolution_date
    db.add(AuditLog(
        id=uuid.uuid4(),
        actor_user_id=current_user.id,
        action="EDIT_EXCEPTION_HEADLINE",
        target_type="ExceptionTag",
        target_id=str(tag.id),
        before_state=before_state,
        after_state={"reason": tag.reason, "note": tag.note},
        occurred_at=datetime.now(timezone.utc),
    ))
    db.commit()
    db.refresh(tag)
    return ExceptionUpdateResponse(
        id=tag.id,
        invoice_id=tag.invoice_id,
        status=tag.status,
        action_applied="EDIT_HEADLINE",
    )
```

- [ ] **Step 4: Run to confirm pass**

```bash
uv run pytest backend/tests/integration/test_exceptions_crud.py -k "edit_headline" -xvs
```
Expected: all 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/services/exception_service.py backend/tests/integration/test_exceptions_crud.py
git commit -m "feat(exceptions): EDIT_HEADLINE action on PATCH /exceptions/:id with audit log"
```

---

### Task 10: Admin endpoints — canonical merge + audit-log filters + email rules + invoice snapshot history

**Files:**
- Modify: `backend/src/app/api/routes/admin.py`
- Modify: `backend/src/app/api/routes/invoices.py`
- Test: `backend/tests/integration/test_admin_audit_log.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/integration/test_admin_audit_log.py`:

```python
def test_audit_log_actions_endpoint(client, admin_headers):
    resp = client.get("/admin/audit-log/actions", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    if data:
        assert "action" in data[0]
        assert "count" in data[0]

def test_audit_log_actors_endpoint(client, admin_headers):
    resp = client.get("/admin/audit-log/actors", headers=admin_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)

def test_audit_log_actions_requires_admin(client, analyst_headers):
    resp = client.get("/admin/audit-log/actions", headers=analyst_headers)
    assert resp.status_code == 403
```

- [ ] **Step 2: Add endpoints to admin.py**

In `backend/src/app/api/routes/admin.py`, add:

```python
from sqlalchemy import func, select, distinct
from app.db.models.audit_log import AuditLog
from app.db.models.user import User as UserModel


@router.get("/admin/audit-log/actions", tags=["admin"])
def audit_log_actions(
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    _: Annotated[User, Depends(require_role(Role.ADMIN))] = ...,  # type: ignore[assignment]
) -> list[dict]:
    rows = session.execute(
        select(AuditLog.action, func.count().label("count"))
        .group_by(AuditLog.action)
        .order_by(func.count().desc())
    ).all()
    return [{"action": r.action, "count": r.count} for r in rows]


@router.get("/admin/audit-log/actors", tags=["admin"])
def audit_log_actors(
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    _: Annotated[User, Depends(require_role(Role.ADMIN))] = ...,  # type: ignore[assignment]
) -> list[dict]:
    rows = session.execute(
        select(UserModel.email, func.count(AuditLog.id).label("count"))
        .join(AuditLog, AuditLog.actor_user_id == UserModel.id)
        .group_by(UserModel.email)
        .order_by(func.count(AuditLog.id).desc())
    ).all()
    return [{"actor_email": r.email, "count": r.count} for r in rows]


@router.post("/admin/canonicals/merge", status_code=200, tags=["admin"])
def merge_canonicals(
    body: CanonicalMergeRequest,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    current_user: Annotated[User, Depends(require_role(Role.ADMIN))] = ...,  # type: ignore[assignment]
) -> dict:
    """Move all aliases + CP rows from source → target canonical, delete source."""
    from app.db.models.party_canonical import PartyCanonical
    from app.db.models.party_alias import PartyAlias
    from app.db.models.credit_period_config import CreditPeriodConfig

    source = session.get(PartyCanonical, body.source_canonical_id)
    target = session.get(PartyCanonical, body.target_canonical_id)
    if source is None or target is None:
        raise HTTPException(status_code=404, detail="Source or target canonical not found.")

    before = {"source_name": source.name, "target_name": target.name}
    # Move aliases
    session.execute(
        PartyAlias.__table__.update()
        .where(PartyAlias.canonical_id == source.id)
        .values(canonical_id=target.id)
    )
    # Move CP config rows
    session.execute(
        CreditPeriodConfig.__table__.update()
        .where(CreditPeriodConfig.canonical_id == source.id)
        .values(canonical_id=target.id)
    )
    session.delete(source)
    session.add(AuditLog(
        id=uuid.uuid4(),
        actor_user_id=current_user.id,
        action="CANONICAL_MERGE",
        target_type="PartyCanonical",
        target_id=str(source.id),
        before_state=before,
        after_state={"target_id": str(target.id), "reason": body.reason},
        occurred_at=datetime.now(timezone.utc),
    ))
    session.commit()
    return {"merged_into": str(target.id)}
```

Add `CanonicalMergeRequest` schema (can be inline or in `schemas/admin.py`):

```python
class CanonicalMergeRequest(BaseModel):
    source_canonical_id: UUID
    target_canonical_id: UUID
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_min_length(cls, v: str) -> str:
        if len(v.strip()) < 10:
            raise ValueError("reason must be at least 10 characters")
        return v
```

- [ ] **Step 3: Add invoice snapshot history to invoices.py**

In `backend/src/app/api/routes/invoices.py`, add:

```python
@router.get("/invoices/{invoice_id}/snapshot-history", tags=["invoices"])
def invoice_snapshot_history(
    invoice_id: uuid.UUID,
    session: Annotated[Session, Depends(db_session)] = ...,  # type: ignore[assignment]
    _: Annotated[User, Depends(require_role(Role.ANALYST, Role.ADMIN, Role.CFO))] = ...,  # type: ignore[assignment]
) -> list[dict]:
    from app.db.models.invoice_snapshot import InvoiceSnapshot
    from app.db.models.snapshot import Snapshot
    rows = session.execute(
        select(
            InvoiceSnapshot.snapshot_id,
            InvoiceSnapshot.outstanding_amount,
            InvoiceSnapshot.overdue_days,
            InvoiceSnapshot.bucket,
            Snapshot.as_of_date,
        )
        .join(Snapshot, Snapshot.id == InvoiceSnapshot.snapshot_id)
        .where(InvoiceSnapshot.invoice_id == invoice_id)
        .order_by(Snapshot.as_of_date.desc())
    ).all()
    if not rows and not session.get(Invoice, invoice_id):  # type: ignore[name-defined]
        raise HTTPException(status_code=404, detail="Invoice not found.")
    return [
        {
            "snapshot_id": str(r.snapshot_id),
            "as_of_date": str(r.as_of_date),
            "outstanding_amount": float(r.outstanding_amount) if r.outstanding_amount else None,
            "overdue_days": r.overdue_days,
            "bucket": r.bucket,
        }
        for r in rows
    ]
```

- [ ] **Step 4: Run tests**

```bash
uv run pytest backend/tests/integration/test_admin_audit_log.py -k "actions or actors" -xvs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/app/api/routes/admin.py backend/src/app/api/routes/invoices.py backend/tests/integration/test_admin_audit_log.py
git commit -m "feat(api): audit-log filter endpoints, canonical merge, invoice snapshot history"
```

---

## Phase 3 — Workspace frontend

### Task 11: WorkspacePage + route

**Files:**
- Create: `frontend/src/pages/WorkspacePage.tsx`
- Create: `frontend/src/__tests__/WorkspacePage.test.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add route to App.tsx**

In `frontend/src/App.tsx`, add inside the router (after Upload, before Dashboard):

```tsx
import { WorkspacePage } from "@/pages/WorkspacePage";
import { SnapshotInvoicesPage } from "@/pages/SnapshotInvoicesPage";

// Inside <Routes>:
<Route path="/snapshots" element={<ProtectedRoute roles={["ANALYST","CFO","ADMIN"]}><WorkspacePage /></ProtectedRoute>} />
<Route path="/snapshots/:id/invoices" element={<ProtectedRoute roles={["ANALYST","CFO","ADMIN"]}><SnapshotInvoicesPage /></ProtectedRoute>} />
```

- [ ] **Step 2: Write failing test**

```tsx
// frontend/src/__tests__/WorkspacePage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorkspacePage } from "@/pages/WorkspacePage";

const MOCK_SNAPSHOTS = {
  items: [
    {
      id: "snap-001",
      entity_code: "IND",
      source_hint: "TALLY",
      status: "PUBLISHED",
      as_of_date: "2026-04-19",
      row_count: 291,
      outstanding_total: 18720000,
      uploaded_by_email: "teja@emb.global",
      created_at: "2026-04-19T10:00:00Z",
    },
    {
      id: "snap-002",
      entity_code: "UAE",
      source_hint: "XERO",
      status: "STAGED",
      as_of_date: "2026-04-18",
      row_count: 47,
      outstanding_total: null,
      uploaded_by_email: "teja@emb.global",
      created_at: "2026-04-18T09:00:00Z",
    },
  ],
  total: 2,
  page: 1,
  page_size: 25,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: () => Promise.resolve(MOCK_SNAPSHOTS),
  }));
});

function Wrapper() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/snapshots"]}>
        <Routes>
          <Route path="/snapshots" element={<WorkspacePage />} />
          <Route path="/snapshots/:id/invoices" element={<div>Invoices</div>} />
          <Route path="/staging/:id" element={<div>Staging</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("WorkspacePage", () => {
  it("shows page heading", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText(/workspace/i)).toBeInTheDocument());
  });

  it("renders PUBLISHED snapshot with View invoices action", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText("View invoices")).toBeInTheDocument());
  });

  it("renders STAGED snapshot with Review staging action", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText("Review staging")).toBeInTheDocument());
  });

  it("shows entity badge IND", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText("IND")).toBeInTheDocument());
  });

  it("shows uploaded_by_email", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getAllByText("teja@emb.global").length).toBeGreaterThan(0));
  });
});
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd frontend && npm run test -- --run src/__tests__/WorkspacePage.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 4: Create WorkspacePage.tsx**

```tsx
// frontend/src/pages/WorkspacePage.tsx
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { useState } from "react";

interface SnapshotRow {
  id: string;
  entity_code: string;
  source_hint: string;
  status: string;
  as_of_date: string;
  row_count: number | null;
  outstanding_total: number | null;
  uploaded_by_email: string | null;
  created_at: string;
}

interface SnapshotListResponse {
  items: SnapshotRow[];
  total: number;
  page: number;
  page_size: number;
}

const STATUS_COLORS: Record<string, string> = {
  PUBLISHED: "bg-green-100 text-green-800",
  STAGED: "bg-yellow-100 text-yellow-800",
  PARSING: "bg-blue-100 text-blue-800",
  DISCARDED: "bg-gray-100 text-gray-600",
};

function fmtCrore(n: number | null): string {
  if (n == null) return "—";
  const cr = n / 10_000_000;
  return `₹${cr.toFixed(2)} Cr`;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return "< 1 hr ago";
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)} days ago`;
}

function actionButton(snap: SnapshotRow): React.ReactNode {
  if (snap.status === "PUBLISHED") {
    if (snap.source_hint === "CP") {
      return <Link to="/config/credit-period" className="text-blue-600 text-sm hover:underline">View config</Link>;
    }
    return <Link to={`/snapshots/${snap.id}/invoices`} className="text-blue-600 text-sm hover:underline">View invoices</Link>;
  }
  if (snap.status === "STAGED") {
    return <Link to={`/staging/${snap.id}`} className="text-blue-600 text-sm hover:underline">Review staging</Link>;
  }
  if (snap.status === "PARSING") {
    return <span className="text-gray-400 text-sm">Parsing…</span>;
  }
  return <span className="text-gray-400 text-sm">View details</span>;
}

export function WorkspacePage() {
  const [page, setPage] = useState(1);
  // Note: fmtCrore used in D2PartyDetailPage must be extracted to a shared util
  // e.g. frontend/src/lib/format.ts → export function fmtCrore(n: number | null): string
  const [searchParams, setSearchParams] = useSearchParams();
  const entity = searchParams.get("entity") ?? "";
  const source = searchParams.get("source") ?? "";
  const status = searchParams.get("status") ?? "";

  const query = useQuery<SnapshotListResponse>({
    queryKey: ["workspace-snapshots", page, entity, source, status],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: "25" });
      if (entity) params.set("entity_code", entity);
      if (source) params.set("source_hint", source);
      if (status) params.set("status", status);
      return api.get<SnapshotListResponse>(`/snapshots?${params}`);
    },
  });

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Workspace — All snapshots</h1>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {[
          { label: "Entity", key: "entity", options: ["IND", "UAE"] },
          { label: "Source", key: "source", options: ["TALLY", "XERO", "CP"] },
          { label: "Status", key: "status", options: ["PUBLISHED", "STAGED", "PARSING", "DISCARDED"] },
        ].map(({ label, key, options }) => (
          <select
            key={key}
            className="border rounded px-2 py-1 text-sm"
            value={searchParams.get(key) ?? ""}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              if (e.target.value) next.set(key, e.target.value);
              else next.delete(key);
              setSearchParams(next);
              setPage(1);
            }}
          >
            <option value="">{label}: All</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
      </div>

      {/* Table */}
      {query.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : query.isError ? (
        <p className="text-red-600">Failed to load snapshots.</p>
      ) : query.data!.items.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg">No snapshots yet</p>
          <p className="text-sm mt-1"><Link to="/upload" className="text-blue-600 hover:underline">Upload one from /upload</Link></p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-gray-500 text-xs uppercase tracking-wide">
                  <th className="py-2 pr-4">As-of</th>
                  <th className="py-2 pr-4">Entity</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Rows</th>
                  <th className="py-2 pr-4">Outstanding</th>
                  <th className="py-2 pr-4">Uploaded by</th>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {query.data!.items.map((snap) => (
                  <tr key={snap.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 pr-4 font-mono text-xs">{snap.as_of_date}</td>
                    <td className="py-2 pr-4"><Badge className="text-xs">{snap.entity_code}</Badge></td>
                    <td className="py-2 pr-4 text-gray-600">{snap.source_hint}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[snap.status] ?? "bg-gray-100"}`}>
                        {snap.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{snap.row_count ?? "—"}</td>
                    <td className="py-2 pr-4">{fmtCrore(snap.outstanding_total)}</td>
                    <td className="py-2 pr-4 text-gray-500 text-xs">{snap.uploaded_by_email ?? "—"}</td>
                    <td className="py-2 pr-4 text-gray-500 text-xs" title={snap.created_at}>{relativeTime(snap.created_at)}</td>
                    <td className="py-2">{actionButton(snap)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={query.data!.page}
            total={query.data!.total}
            pageSize={query.data!.page_size}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to confirm pass**

```bash
cd frontend && npm run test -- --run src/__tests__/WorkspacePage.test.tsx
```
Expected: all 5 PASS.

- [ ] **Step 6: Typecheck**

```bash
cd frontend && npm run typecheck 2>&1 | grep -i error | head -20
```
Expected: 0 errors in new file.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/WorkspacePage.tsx frontend/src/__tests__/WorkspacePage.test.tsx frontend/src/App.tsx
git commit -m "feat(ui): WorkspacePage /snapshots — browse all uploads with drill-through"
```

---

### Task 12: SnapshotInvoicesPage

**Files:**
- Create: `frontend/src/pages/SnapshotInvoicesPage.tsx`
- Create: `frontend/src/__tests__/SnapshotInvoicesPage.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// frontend/src/__tests__/SnapshotInvoicesPage.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SnapshotInvoicesPage } from "@/pages/SnapshotInvoicesPage";

const SNAP_META = {
  id: "snap-001", entity_code: "IND", source_hint: "TALLY",
  status: "PUBLISHED", as_of_date: "2026-04-19",
  uploaded_by_email: "teja@emb.global", created_at: "2026-04-19T10:00:00Z",
};
const INVOICES = {
  items: [
    { id: "inv-001", canonical_name: "ACME Ltd", invoice_ref: "INV-2001",
      invoice_date: "2026-03-01", due_date: "2026-03-31",
      overdue_days: 19, bucket: "0_30", outstanding_amount: 100000,
      exception_tags: [] },
  ],
  total: 1, page: 1, page_size: 50,
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((url: string) => {
    if (url.includes("/invoices?")) return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(INVOICES) });
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SNAP_META) });
  }));
});

function Wrapper() {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/snapshots/snap-001/invoices"]}>
        <Routes>
          <Route path="/snapshots/:id/invoices" element={<SnapshotInvoicesPage />} />
          <Route path="/invoice/:id" element={<div>Invoice detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("SnapshotInvoicesPage", () => {
  it("shows snapshot metadata in header", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText("IND")).toBeInTheDocument());
  });

  it("shows invoice rows", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText("ACME Ltd")).toBeInTheDocument());
  });

  it("shows bucket badge", async () => {
    render(<Wrapper />);
    await waitFor(() => expect(screen.getByText("0_30")).toBeInTheDocument());
  });

  it("links invoice to /invoice/:id", async () => {
    render(<Wrapper />);
    await waitFor(() => {
      const link = screen.getByRole("link", { name: /ACME Ltd/i });
      expect(link).toHaveAttribute("href", "/invoice/inv-001");
    });
  });
});
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd frontend && npm run test -- --run src/__tests__/SnapshotInvoicesPage.test.tsx
```

- [ ] **Step 3: Create SnapshotInvoicesPage.tsx**

```tsx
// frontend/src/pages/SnapshotInvoicesPage.tsx
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { useState } from "react";

interface SnapMeta {
  id: string; entity_code: string; source_hint: string;
  status: string; as_of_date: string;
  uploaded_by_email: string | null; created_at: string;
}

interface InvoiceRow {
  id: string; canonical_name: string; invoice_ref: string;
  invoice_date: string; due_date: string;
  overdue_days: number; bucket: string;
  outstanding_amount: number | null;
  exception_tags: { bucket_type_code: string }[];
}

const BUCKET_COLORS: Record<string, string> = {
  NOT_DUE: "bg-gray-100 text-gray-700",
  "0_30": "bg-yellow-100 text-yellow-800",
  "31_60": "bg-orange-100 text-orange-800",
  "61_90": "bg-red-100 text-red-700",
  "90_PLUS": "bg-red-200 text-red-900",
};

export function SnapshotInvoicesPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);
  const [party, setParty] = useState("");

  const snapQuery = useQuery<SnapMeta>({
    queryKey: ["snapshot-meta", id],
    queryFn: () => api.get<SnapMeta>(`/snapshots/${id}`),
  });

  const invQuery = useQuery<{ items: InvoiceRow[]; total: number; page: number; page_size: number }>({
    queryKey: ["snapshot-invoices", id, page, party],
    queryFn: () => {
      const p = new URLSearchParams({ snapshot_id: id!, page: String(page), page_size: "50" });
      if (party) p.set("party_query", party);
      return api.get(`/invoices?${p}`);
    },
    enabled: !!id,
  });

  const { data: currentUser } = useCurrentUser();
  const isAdmin = currentUser?.role === "ADMIN";
  const snap = snapQuery.data;

  if (snap?.source_hint === "CP" && invQuery.data?.items.length === 0) {
    return (
      <div className="p-6">
        <p className="text-gray-500">
          Credit-period imports don't generate invoice rows.{" "}
          <Link to="/config/credit-period" className="text-blue-600 hover:underline">View the config</Link>.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      {snap ? (
        <div className="bg-white border rounded p-4 flex gap-6 text-sm">
          <span><Badge>{snap.entity_code}</Badge></span>
          <span className="text-gray-500">Source: {snap.source_hint}</span>
          <span className="text-gray-500">As-of: {snap.as_of_date}</span>
          <span className="text-gray-500">Status: {snap.status}</span>
          {snap.uploaded_by_email && <span className="text-gray-500">By: {snap.uploaded_by_email}</span>}
        </div>
      ) : <Skeleton className="h-14 w-full" />}

      <h1 className="text-xl font-semibold">Invoices in snapshot</h1>

      {/* Filter */}
      <input
        className="border rounded px-3 py-1.5 text-sm w-72"
        placeholder="Search party…"
        value={party}
        onChange={(e) => { setParty(e.target.value); setPage(1); }}
      />

      {/* Table */}
      {invQuery.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="py-2 pr-4">Party</th>
                  <th className="py-2 pr-4">Ref</th>
                  <th className="py-2 pr-4">Invoice date</th>
                  <th className="py-2 pr-4">Due date</th>
                  <th className="py-2 pr-4">Days</th>
                  <th className="py-2 pr-4">Bucket</th>
                  <th className="py-2 pr-4">Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {(invQuery.data?.items ?? []).map((inv) => (
                  <tr key={inv.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 pr-4">
                      <Link to={`/invoice/${inv.id}`} className="text-blue-600 hover:underline">{inv.canonical_name}</Link>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-gray-600">{inv.invoice_ref}</td>
                    <td className="py-2 pr-4 text-gray-500 text-xs">{inv.invoice_date}</td>
                    <td className="py-2 pr-4 text-gray-500 text-xs">{inv.due_date}</td>
                    <td className="py-2 pr-4">{inv.overdue_days}</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${BUCKET_COLORS[inv.bucket] ?? ""}`}>
                        {inv.bucket}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {inv.outstanding_amount != null ? `₹${(inv.outstanding_amount / 100000).toFixed(2)}L` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={invQuery.data?.page ?? 1}
            total={invQuery.data?.total ?? 0}
            pageSize={invQuery.data?.page_size ?? 50}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
cd frontend && npm run test -- --run src/__tests__/SnapshotInvoicesPage.test.tsx
```
Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/SnapshotInvoicesPage.tsx frontend/src/__tests__/SnapshotInvoicesPage.test.tsx
git commit -m "feat(ui): SnapshotInvoicesPage /snapshots/:id/invoices sub-route"
```

---

## Phase 4 — Wireframe parity (summary tasks)

> These tasks are less step-heavy because they modify existing pages, not create new ones. TDD still applies — write the assertion, confirm fail, implement, confirm pass.

### Task 13: S1 Upload — entity toggle + Uploaded by column + PARSING status

**Files:** `frontend/src/pages/S1UploadPage.tsx`

- [ ] **Step 1: Write assertions** (add to `frontend/src/__tests__/S1UploadPage.test.tsx`):

```tsx
it("shows IND/UAE toggle buttons in the upload form", async () => {
  render(<Wrapper />);  // Wrapper from existing test file
  // entity toggle buttons must exist in upload form area
  expect(screen.getByRole("button", { name: /^IND$/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^UAE$/ })).toBeInTheDocument();
});

it("recent uploads table has Uploaded by column", async () => {
  render(<Wrapper />);
  await waitFor(() => expect(screen.getByText(/uploaded by/i)).toBeInTheDocument());
});
```

- [ ] **Step 2: Run to confirm fail**, then implement:

**Entity toggle** — In `S1UploadPage.tsx`, above the source radio, add:
```tsx
{/* Entity toggle — updates ?entity= URL param */}
<div className="flex gap-2 mb-4">
  {["IND", "UAE"].map((e) => (
    <button
      key={e}
      type="button"
      onClick={() => setSearchParams((p) => { p.set("entity", e); return p; })}
      className={`px-4 py-1.5 rounded border text-sm font-medium ${
        entity === e ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-700 border-gray-300"
      }`}
    >
      {e}
    </button>
  ))}
</div>
```

**Uploaded by column** — In the recent uploads table header, add `<th>Uploaded by</th>` and in the row, add `<td>{snap.uploaded_by_email ?? "—"}</td>`.

**PARSING status** — Remove any filter that hides PARSING rows from the recent uploads list; render them with a spinner badge.

- [ ] **Step 3: Run to confirm pass**, then commit:

```bash
git add frontend/src/pages/S1UploadPage.tsx frontend/src/__tests__/S1UploadPage.test.tsx
git commit -m "feat(S1): entity toggle in form + Uploaded by column + PARSING status row"
```

---

### Task 14: S2 Staging — credit-source badges + per-warning ack + PARSE_ERROR collapsible

**Files:** `frontend/src/pages/S2StagingPage.tsx`

- [ ] **Write assertion:**

```tsx
// In S2 test — check credit days column has source badge
it("credit days column shows source badge config/default/manual", async () => {
  // mock staging row with credit_days_source = "config"
  // assert Badge with text "config" appears in table
  await waitFor(() => expect(screen.getByText("config")).toBeInTheDocument());
});
```

- [ ] **Implement:** In the staging grid's credit-days cell, wrap the number with a source badge:

```tsx
// CreditDaysCell component:
function CreditDaysCell({ days, source }: { days: number; source: "config" | "default" | "manual" }) {
  const colors = { config: "bg-blue-100 text-blue-700", default: "bg-gray-100 text-gray-600", manual: "bg-purple-100 text-purple-700" };
  return (
    <span className="flex items-center gap-1">
      {days}
      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colors[source]}`} title={source === "manual" ? "Set manually by reviewer" : undefined}>
        {source}
      </span>
    </span>
  );
}
```

For warnings panel — split into per-warning rows with individual Acknowledge buttons (each calling the existing ack mutation with the warning key).

For PARSE_ERROR section — wrap in `<details><summary>PARSE_ERROR rows ({count})</summary>...</details>` above the staging grid.

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/S2StagingPage.tsx
git commit -m "feat(S2): credit-source badges, per-warning ack buttons, PARSE_ERROR collapsible"
```

---

### Task 15: D1 Dashboard — dual overdue display + KPI sub-lines + WoW tiles

**Files:** `frontend/src/pages/D1DashboardPage.tsx`

- [ ] **Write assertions:**

```tsx
it("TallyOverdueCell shows both Tally and Ours figures", async () => {
  // mock top_parties with tally_overdue_days and our overdue_days both present
  await waitFor(() => {
    expect(screen.getByText(/tally/i)).toBeInTheDocument();
    expect(screen.getByText(/ours/i)).toBeInTheDocument();
  });
});
```

- [ ] **Implement:**

`TallyOverdueCell` — change to show dual display:
```tsx
function TallyOverdueCell({ tallyDays, ourDays }: { tallyDays: number | null; ourDays: number }) {
  if (tallyDays == null) return <span title="Tally days unavailable">Ours: {ourDays}</span>;
  return (
    <span className="text-xs leading-tight">
      <span className="block">Tally: {tallyDays}d</span>
      <span className="block text-gray-500">Ours: {ourDays}d</span>
    </span>
  );
}
```

KPI tiles:
- "Parties 90+ days": add `<p className="text-xs text-gray-500 mt-0.5">{fmtCrore(kpis.parties_90_plus_amount)} at risk</p>`.
- "% Overdue": add WoW delta `<span className={delta > 0 ? "text-red-500" : "text-green-500"}>{delta > 0 ? "▲" : "▼"}{Math.abs(delta).toFixed(1)}%</span>`.

Top-10 table: add `# Invoices` column using `party.invoice_count` (add to API response if missing).

WoW mini-tiles below sparkline:
```tsx
{trend_snapshots.slice(-4).map((t, i) => (
  <div key={i} className="text-center text-xs">
    <div className="text-gray-400">W-{3 - i === 0 ? "Now" : 3 - i}</div>
    <div className="font-medium">{fmtCrore(t.total_open)}</div>
  </div>
))}
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/D1DashboardPage.tsx
git commit -m "feat(D1): dual overdue display, KPI sub-lines, WoW delta tile, WoW mini-tiles"
```

---

### Task 16: S5 Exceptions — bucket ₹ + unconditional banner + explainer + notes panel + edit modal

**Files:** `frontend/src/pages/S5ExceptionsPage.tsx`

This task covers both wireframe parity (₹ totals, banners) AND notes UX (panel, edit). They're in the same file.

- [ ] **Bucket ₹ totals:** In bucket summary cards, use `outstanding_amount` from the API (now returned per Task 5):
```tsx
<p className="text-lg font-semibold">
  {row.outstanding_amount != null ? `₹${(Number(row.outstanding_amount) / 10_000_000).toFixed(2)} Cr` : "—"}
</p>
```

- [ ] **Unconditional material-change banner:** Remove the `snapshot_id` URL-param guard. Instead, always show the banner if `material_changes.length > 0` from the latest snapshot query.

- [ ] **Explainer banner** (dismissible via `localStorage`):
```tsx
const [dismissed, setDismissed] = useState(() => localStorage.getItem("s5-explainer-dismissed") === "1");
{!dismissed && (
  <div className="bg-blue-50 border border-blue-200 rounded p-3 flex justify-between text-sm text-blue-800">
    <span>Exceptions are persistent classifications on invoices. Follow-ups are time-bound actions. <Link to="/follow-ups" className="underline">Manage follow-ups →</Link></span>
    <button onClick={() => { setDismissed(true); localStorage.setItem("s5-explainer-dismissed", "1"); }}>✕</button>
  </div>
)}
```

- [ ] **Notes side panel:** When a row is clicked, open a side panel (right-side drawer using `Modal` or inline):
```tsx
{selectedExceptionId && (
  <ExceptionNotesPanel
    exceptionId={selectedExceptionId}
    onClose={() => setSelectedExceptionId(null)}
  />
)}
```

`ExceptionNotesPanel` component (same file or extracted):
```tsx
function ExceptionNotesPanel({ exceptionId, onClose }: { exceptionId: string; onClose: () => void }) {
  const notesQ = useQuery({
    queryKey: ["exception-notes", exceptionId],
    queryFn: () => api.get<ExceptionNoteRow[]>(`/exceptions/${exceptionId}/notes`),
  });
  const [body, setBody] = useState("");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.post(`/exceptions/${exceptionId}/notes`, { body }),
    onSuccess: () => { setBody(""); queryClient.invalidateQueries({ queryKey: ["exception-notes", exceptionId] }); },
  });

  return (
    <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-xl border-l flex flex-col z-50">
      <div className="flex justify-between items-center p-4 border-b">
        <h2 className="font-semibold">Exception notes</h2>
        <button onClick={onClose}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {notesQ.data?.map((n) => (
          <div key={String(n.id)} className="bg-gray-50 rounded p-3 text-sm">
            <p className="font-medium text-xs text-gray-400 mb-1">{n.author_email} · {new Date(n.created_at).toLocaleDateString("en-IN")}</p>
            <p>{n.body}</p>
          </div>
        ))}
        {notesQ.data?.length === 0 && <p className="text-gray-400 text-sm text-center py-8">No notes yet</p>}
      </div>
      <div className="p-4 border-t space-y-2">
        <textarea
          className="w-full border rounded p-2 text-sm resize-none"
          rows={3}
          placeholder="Add a note…"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
        />
        <button
          disabled={!body.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="w-full bg-blue-600 text-white rounded py-1.5 text-sm disabled:opacity-50"
        >
          {mutation.isPending ? "Adding…" : "Add note"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Edit headline modal:** Add pencil icon to each row; clicking opens `ExceptionEditModal` pre-filled with `reason`, `note`, `expected_resolution_date`. On submit, calls `PATCH /exceptions/:id` with `action: "EDIT_HEADLINE"`.

- [ ] **Write vitest assertions:**

```tsx
it("explainer banner visible on first load", () => {
  localStorage.clear();
  render(<Wrapper />);
  expect(screen.getByText(/exceptions are persistent/i)).toBeInTheDocument();
});

it("dismissing explainer sets localStorage", async () => {
  localStorage.clear();
  render(<Wrapper />);
  fireEvent.click(screen.getByText("✕"));
  expect(localStorage.getItem("s5-explainer-dismissed")).toBe("1");
});
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/S5ExceptionsPage.tsx
git commit -m "feat(S5): bucket ₹ totals, unconditional banner, explainer, notes panel, edit modal"
```

---

### Task 17: A6 Reconciliation — KPI copy + publish-gate banner

**Files:** `frontend/src/pages/A6ReconciliationPage.tsx`

- [ ] **KPI inline copy:** Under each of the 4 KPI tiles, add an explanatory `<p className="text-xs text-gray-400 mt-1">` line. Example:
```tsx
// Dashboard AR tile
<p className="text-xs text-gray-400 mt-1">
  Sum of open invoice outstanding for Snapshot #{selectedSnapshotId}. {snap.invoice_count ?? "?"} invoices.
</p>
```

- [ ] **Publish-gate warning banner:** Above the reconciliation form, if `reconciliation.status === "MISMATCHED"`:
```tsx
{recon?.status === "MISMATCHED" && (
  <div className="bg-yellow-50 border border-yellow-300 rounded p-3 flex justify-between items-center">
    <span className="text-yellow-800 text-sm font-medium">
      ⚠ Publish of next snapshot is blocked until this reconciliation is MATCHED.
    </span>
    {isAdmin && (
      <button onClick={() => adminOverrideMutation.mutate()} className="ml-4 text-sm text-yellow-700 underline">
        Admin override
      </button>
    )}
  </div>
)}
```

- [ ] **Write assertion + run + commit:**

```bash
git add frontend/src/pages/A6ReconciliationPage.tsx
git commit -m "feat(A6): KPI inline explanatory copy + MISMATCHED publish-gate warning banner"
```

---

## Phase 5 — Redesigned non-wireframed pages

### Task 18: D2 Party Detail — KPI row + 3 tabs

**Files:** `frontend/src/pages/D2PartyDetailPage.tsx`

- [ ] **Write assertions:**

```tsx
it("renders KPI row with Exposure, Ageing, and FX tiles", async () => {
  render(<Wrapper />);
  await waitFor(() => {
    expect(screen.getByText(/exposure/i)).toBeInTheDocument();
    expect(screen.getByText(/ageing/i)).toBeInTheDocument();
  });
});

it("renders Invoices, Follow-up timeline, Exceptions tabs", async () => {
  render(<Wrapper />);
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /invoices/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /follow.up timeline/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /exceptions/i })).toBeInTheDocument();
  });
});
```

- [ ] **Implement party header + KPI row:**

```tsx
{/* Header */}
<div className="bg-white border rounded p-4">
  <div className="flex items-center gap-3">
    <h1 className="text-xl font-semibold">{party.canonical_name}</h1>
    <Badge>{party.entity_code}</Badge>
    {activeExceptions > 0 && <Badge className="bg-red-100 text-red-700">{activeExceptions} active exceptions</Badge>}
  </div>
  <p className="text-sm text-gray-500 mt-1">Aliases: {party.aliases.join(", ")}</p>
  <p className="text-sm text-gray-500">Credit period: {party.credit_days}d
    <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">{party.credit_days_source}</span>
  </p>
</div>

{/* KPI row */}
<div className="grid grid-cols-3 gap-4">
  <Card><p className="text-xs text-gray-500">Exposure</p>
    <p className="text-xl font-semibold">{fmtCrore(party.total_open)}</p>
    <p className="text-xs text-gray-400">{party.open_invoice_count} invoices</p>
  </Card>
  <Card><p className="text-xs text-gray-500">Ageing split</p>
    <AgeingMiniBar buckets={party.ageing_buckets} />
  </Card>
  {party.entity_code === "UAE" && (
    <Card><p className="text-xs text-gray-500">FX (AED→INR)</p>
      <p className="text-xl font-semibold">{party.fx_rate ?? "—"}</p>
    </Card>
  )}
</div>
```

- [ ] **Implement tab switcher:**

```tsx
const [tab, setTab] = useState<"invoices" | "timeline" | "exceptions">("invoices");

const tabs = [
  { id: "invoices", label: "Invoices" },
  { id: "timeline", label: "Follow-up timeline" },
  { id: "exceptions", label: "Exceptions" },
] as const;

{/* Tab bar */}
<div className="flex border-b">
  {tabs.map((t) => (
    <button key={t.id} onClick={() => setTab(t.id)}
      className={`px-4 py-2 text-sm font-medium ${tab === t.id ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500"}`}>
      {t.label}
    </button>
  ))}
</div>

{/* Tab content */}
{tab === "invoices" && <PartyInvoicesTable partyId={id} />}
{tab === "timeline" && <FollowUpTimeline partyId={id} />}
{tab === "exceptions" && <PartyExceptionsTab partyId={id} />}
```

**FollowUpTimeline** (inline component):
```tsx
function FollowUpTimeline({ partyId }: { partyId: string }) {
  const q = useQuery({ queryKey: ["party-followups", partyId],
    queryFn: () => api.get<FollowUpRow[]>(`/follow-ups?party_id=${partyId}&page_size=50`) });
  if (!q.data?.length) return <p className="text-gray-400 py-8 text-center text-sm">No follow-ups logged for this party.</p>;
  return (
    <div className="relative space-y-4 pl-6 before:absolute before:left-2 before:top-0 before:bottom-0 before:w-px before:bg-gray-200">
      {q.data.map((f) => (
        <div key={f.id} className="relative">
          <div className="absolute -left-4 w-2 h-2 rounded-full bg-blue-400 top-1" />
          <div className="text-xs text-gray-400 mb-0.5">{f.follow_up_date} · <Badge className="text-xs">{f.channel}</Badge> · {f.actor_email}</div>
          <p className="text-sm">{f.note}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/D2PartyDetailPage.tsx
git commit -m "feat(D2): KPI row + follow-up timeline tab + exceptions tab"
```

---

### Task 19: D3 Invoice Detail — raw row + snapshot history + related

**Files:** `frontend/src/pages/D3InvoiceDetailPage.tsx`

- [ ] **Write assertion + implement:**

```tsx
it("shows Raw row collapsible section", async () => {
  render(<Wrapper />);
  await waitFor(() => expect(screen.getByText(/raw row/i)).toBeInTheDocument());
});
```

- [ ] **Implement the three sections below existing content:**

**Raw row:**
```tsx
<details className="mt-4 border rounded">
  <summary className="px-4 py-2 cursor-pointer text-sm font-medium text-gray-700 hover:bg-gray-50">
    Raw row (original parsed JSON)
  </summary>
  <div className="relative">
    <button
      onClick={() => navigator.clipboard.writeText(JSON.stringify(rawRow, null, 2))}
      className="absolute top-2 right-2 text-xs text-gray-400 hover:text-gray-700"
    >
      Copy
    </button>
    <pre className="p-4 text-xs bg-gray-50 overflow-x-auto font-mono">
      {rawRow ? JSON.stringify(rawRow, null, 2) : "No raw row available."}
    </pre>
  </div>
</details>
```

**Snapshot history** (uses `GET /invoices/:id/snapshot-history`):
```tsx
const historyQ = useQuery({
  queryKey: ["invoice-history", invoiceId],
  queryFn: () => api.get<SnapHistoryRow[]>(`/invoices/${invoiceId}/snapshot-history`),
});

{historyQ.data && (
  <div className="mt-4">
    <h3 className="text-sm font-semibold mb-2">Snapshot history</h3>
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="border-b text-gray-500">
          <th className="text-left py-1 pr-3">As-of</th>
          <th className="text-left py-1 pr-3">Outstanding</th>
          <th className="text-left py-1 pr-3">Days overdue</th>
          <th className="text-left py-1">Bucket</th>
        </tr>
      </thead>
      <tbody>
        {historyQ.data.map((h) => (
          <tr key={h.snapshot_id} className="border-b">
            <td className="py-1 pr-3">{h.as_of_date}</td>
            <td className="py-1 pr-3">{h.outstanding_amount != null ? `₹${h.outstanding_amount.toLocaleString("en-IN")}` : "—"}</td>
            <td className="py-1 pr-3">{h.overdue_days}</td>
            <td className="py-1"><span className={`px-1.5 py-0.5 rounded text-xs ${BUCKET_COLORS[h.bucket] ?? ""}`}>{h.bucket}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
```

**Related** (exceptions + follow-ups for this invoice):
```tsx
<div className="mt-4 grid grid-cols-2 gap-4">
  <div>
    <h3 className="text-sm font-semibold mb-2">Exceptions</h3>
    {exceptions?.map((e) => <Link key={e.id} to="/exceptions" className="block text-sm text-blue-600">{e.bucket_type_name}: {e.status}</Link>)}
    {!exceptions?.length && <p className="text-gray-400 text-xs">None</p>}
  </div>
  <div>
    <h3 className="text-sm font-semibold mb-2">Follow-ups</h3>
    {followUps?.map((f) => <p key={f.id} className="text-sm">{f.channel} · {f.follow_up_date}</p>)}
    {!followUps?.length && <p className="text-gray-400 text-xs">None</p>}
  </div>
</div>
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/D3InvoiceDetailPage.tsx
git commit -m "feat(D3): raw row collapsible, snapshot history table, related exceptions/follow-ups"
```

---

### Task 20: S4 Aliases — confidence badges + Merge canonicals modal

**Files:** `frontend/src/pages/S4AliasesPage.tsx`

- [ ] **Implement confidence badges:**

```tsx
function ConfidenceBadge({ matchType, score }: { matchType: string; score: number | null }) {
  if (matchType === "exact") return <span className="px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-600">EXACT</span>;
  if (score == null) return null;
  if (score >= 90) return <span className="px-1.5 py-0.5 rounded text-xs bg-green-100 text-green-700">HIGH ≥90%</span>;
  if (score >= 70) return <span className="px-1.5 py-0.5 rounded text-xs bg-yellow-100 text-yellow-700">MED 70–89%</span>;
  return <span className="px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700">LOW &lt;70%</span>;
}
```

- [ ] **Implement Merge canonicals modal** (ADMIN only):

```tsx
{isAdmin && (
  <button onClick={() => setMergeOpen(true)} className="border rounded px-3 py-1.5 text-sm">
    Merge canonicals
  </button>
)}

{mergeOpen && (
  <Modal onClose={() => setMergeOpen(false)} title="Merge canonicals">
    <div className="space-y-3 p-4">
      <div>
        <label className="text-sm font-medium">Source canonical (will be deleted)</label>
        <select className="w-full border rounded px-2 py-1.5 mt-1 text-sm"
          value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          <option value="">— Select —</option>
          {canonicals?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium">Target canonical (will absorb aliases)</label>
        <select className="w-full border rounded px-2 py-1.5 mt-1 text-sm"
          value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          <option value="">— Select —</option>
          {canonicals?.filter((c) => c.id !== sourceId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <textarea
        className="w-full border rounded p-2 text-sm"
        placeholder="Reason (min 10 chars)…"
        value={mergeReason} onChange={(e) => setMergeReason(e.target.value)}
        rows={2}
      />
      <button
        disabled={!sourceId || !targetId || mergeReason.trim().length < 10 || mergeMutation.isPending}
        onClick={() => mergeMutation.mutate({ source_canonical_id: sourceId, target_canonical_id: targetId, reason: mergeReason })}
        className="w-full bg-red-600 text-white rounded py-1.5 text-sm disabled:opacity-50"
      >
        {mergeMutation.isPending ? "Merging…" : "Confirm merge (irreversible)"}
      </button>
    </div>
  </Modal>
)}
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/S4AliasesPage.tsx
git commit -m "feat(S4): confidence badges + merge canonicals modal (ADMIN)"
```

---

### Task 21: A2 Email Outbox — human timestamps + Resend + Email rules

**Files:** `frontend/src/pages/A2EmailOutboxPage.tsx`

- [ ] **Human timestamps:**

```tsx
function RelTime({ iso }: { iso: string }) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const label = mins < 1 ? "just now" : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
  return <span title={new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>{label}</span>;
}
```

- [ ] **Email rules section:**

```tsx
const rulesQ = useQuery({ queryKey: ["email-rules"],
  queryFn: () => api.get<EmailRule[]>("/admin/email-rules") });

{/* Section 2 — Email rules */}
<h2 className="text-lg font-semibold mt-8 mb-3">Email rules</h2>
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  {rulesQ.data?.map((rule) => (
    <div key={rule.id} className="border rounded p-4 bg-white">
      <div className="flex justify-between items-start">
        <div>
          <p className="font-medium text-sm">{rule.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{rule.description}</p>
          <p className="text-xs text-gray-400 mt-1">Schedule: {rule.schedule_human}</p>
          <p className="text-xs text-gray-400">Last fired: {rule.last_fired_at ? <RelTime iso={rule.last_fired_at} /> : "Never"}</p>
          {rule.next_fire_at && <p className="text-xs text-gray-400">Next fire: {new Date(rule.next_fire_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</p>}
        </div>
        {isAdmin && (
          <label className="flex items-center gap-1 text-xs cursor-pointer">
            <input type="checkbox" checked={rule.enabled}
              onChange={() => toggleRule.mutate({ id: rule.id, enabled: !rule.enabled })} />
            {rule.enabled ? "Enabled" : "Disabled"}
          </label>
        )}
      </div>
    </div>
  ))}
</div>
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/A2EmailOutboxPage.tsx
git commit -m "feat(A2): human timestamps, Resend button, Email rules card grid"
```

---

### Task 22: A3 Exception Buckets — Preview column

**Files:** `frontend/src/pages/A3ExceptionBucketsPage.tsx`

- [ ] **Add Preview column to bucket table:**

```tsx
// In the table, add header:
<th className="py-2 pr-4">Preview</th>

// In each row:
<td className="py-2 pr-4">
  <span style={{ backgroundColor: bucket.color + "20", color: bucket.color }}
    className="px-2 py-0.5 rounded-full text-xs font-medium border"
    style={{ borderColor: bucket.color }}>
    {bucket.name}
  </span>
</td>
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/A3ExceptionBucketsPage.tsx
git commit -m "feat(A3): Preview column showing bucket badge as it appears in S5"
```

---

### Task 23: A4 FX Rates — two-pane SVG timeline

**Files:** `frontend/src/pages/A4FxRatesPage.tsx`

- [ ] **Implement two-pane layout with inline SVG chart:**

```tsx
// Left pane: existing add form (unchanged)
// Right pane: currency pair selector + chart + table

const [pair, setPair] = useState("AED_INR");
const histQ = useQuery({
  queryKey: ["fx-history", pair],
  queryFn: () => api.get<FxRateRow[]>(`/admin/fx-rates?currency_pair=${pair}`),
});

// SVG line chart (same pattern as D1 TrendSparkline)
function FxLineChart({ rates }: { rates: FxRateRow[] }) {
  if (rates.length < 2) return <p className="text-xs text-gray-400">Not enough data points.</p>;
  const W = 400, H = 120, PAD = 20;
  const values = rates.map((r) => r.rate);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const points = rates.map((r, i) => {
    const x = PAD + (i / (rates.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((r.rate - min) / range) * (H - 2 * PAD);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2" />
    </svg>
  );
}
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/A4FxRatesPage.tsx
git commit -m "feat(A4): two-pane layout with SVG rate timeline chart"
```

---

### Task 24: A5 Audit Log — dropdown filters + diff modal

**Files:** `frontend/src/pages/A5AuditLogPage.tsx`

- [ ] **Action/actor dropdowns:**

```tsx
const actionsQ = useQuery({ queryKey: ["audit-actions"], queryFn: () => api.get<ActionCount[]>("/admin/audit-log/actions") });
const actorsQ = useQuery({ queryKey: ["audit-actors"], queryFn: () => api.get<ActorCount[]>("/admin/audit-log/actors") });

<select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
  <option value="">All actions</option>
  {actionsQ.data?.map((a) => <option key={a.action} value={a.action}>{a.action} ({a.count})</option>)}
</select>

<select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
  <option value="">All actors</option>
  {actorsQ.data?.map((a) => <option key={a.actor_email} value={a.actor_email}>{a.actor_email} ({a.count})</option>)}
</select>
```

- [ ] **Diff-highlighted before/after modal:**

```tsx
function JsonDiff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  if (!before && !after) return <p className="text-gray-400 text-xs">No state recorded.</p>;
  const allKeys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  return (
    <div className="grid grid-cols-2 gap-4 font-mono text-xs">
      <div><p className="font-semibold text-gray-500 mb-1">Before</p>
        {allKeys.map((k) => {
          const changed = JSON.stringify((before ?? {})[k]) !== JSON.stringify((after ?? {})[k]);
          const removed = !(k in (after ?? {}));
          return (
            <div key={k} className={`px-1 rounded mb-0.5 ${removed ? "bg-red-100 line-through text-red-600" : changed ? "bg-yellow-100" : ""}`}>
              {k}: {JSON.stringify((before ?? {})[k] ?? undefined)}
            </div>
          );
        })}
      </div>
      <div><p className="font-semibold text-gray-500 mb-1">After</p>
        {allKeys.map((k) => {
          const changed = JSON.stringify((before ?? {})[k]) !== JSON.stringify((after ?? {})[k]);
          const added = !(k in (before ?? {}));
          return (
            <div key={k} className={`px-1 rounded mb-0.5 ${added ? "bg-green-100 text-green-700" : changed ? "bg-yellow-100" : ""}`}>
              {k}: {JSON.stringify((after ?? {})[k] ?? undefined)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/A5AuditLogPage.tsx
git commit -m "feat(A5): action/actor dropdowns, date range filter, diff-highlighted JSON modal"
```

---

## Phase 6 — D2 notes chip

### Task 25: D2 Party Detail Exceptions tab — notes count chip + inline expand

**Files:** `frontend/src/pages/D2PartyDetailPage.tsx`

- [ ] **In D2's Exceptions tab, show notes-count chip per exception row:**

```tsx
function PartyExceptionsTab({ partyId }: { partyId: string }) {
  const q = useQuery({
    queryKey: ["party-exceptions", partyId],
    queryFn: () => api.get<ExceptionListRow[]>(`/exceptions?party_id=${partyId}&page_size=50`),
  });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {q.data?.map((e) => (
        <div key={e.id} className="border rounded p-3">
          <div className="flex justify-between items-start">
            <div>
              <span className="text-sm font-medium">{e.bucket_type_name}</span>
              <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${e.status === "ACTIVE" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500"}`}>{e.status}</span>
              <p className="text-xs text-gray-500 mt-0.5">{e.reason}</p>
            </div>
            <button
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-blue-600"
              onClick={() => setExpandedId(expandedId === e.id ? null : String(e.id))}
            >
              💬 {e.notes_count} {e.notes_count === 1 ? "note" : "notes"}
            </button>
          </div>
          {expandedId === String(e.id) && (
            <InlineNoteThread exceptionId={String(e.id)} />
          )}
        </div>
      ))}
      {!q.data?.length && <p className="text-gray-400 text-sm py-4 text-center">No active exceptions for this party.</p>}
    </div>
  );
}

function InlineNoteThread({ exceptionId }: { exceptionId: string }) {
  const q = useQuery({
    queryKey: ["exception-notes", exceptionId],
    queryFn: () => api.get<ExceptionNoteRow[]>(`/exceptions/${exceptionId}/notes`),
  });
  if (!q.data?.length) return <p className="text-xs text-gray-400 mt-2 pl-2">No notes. Add one from the Exceptions page.</p>;
  return (
    <div className="mt-2 pl-2 border-l-2 border-gray-100 space-y-1.5">
      {q.data.map((n) => (
        <div key={String(n.id)} className="text-xs">
          <span className="text-gray-400">{n.author_email} · {new Date(n.created_at).toLocaleDateString("en-IN")}</span>
          <p className="mt-0.5">{n.body}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Write assertion:**

```tsx
it("shows notes count chip on exception row", async () => {
  // mock exceptions with notes_count: 2
  render(<Wrapper />);
  await waitFor(() => expect(screen.getByText(/2 notes/i)).toBeInTheDocument());
});
```

- [ ] **Run + commit:**

```bash
git add frontend/src/pages/D2PartyDetailPage.tsx
git commit -m "feat(D2): notes-count chip + inline expand on Exceptions tab"
```

---

## Final checks

### Task 26: Full test suite + typecheck + lint

- [ ] **Run all backend tests:**

```bash
uv run pytest backend/tests/unit -q
```
Expected: 0 failures.

- [ ] **Run all frontend tests:**

```bash
cd frontend && npm run test -- --run
```
Expected: 0 failures.

- [ ] **Typecheck frontend:**

```bash
cd frontend && npm run typecheck 2>&1 | grep -c "error TS"
```
Expected: 0.

- [ ] **Lint:**

```bash
uv run ruff check backend/src backend/tests && uv run ruff format --check backend/src backend/tests
```
Expected: `All checks passed!` + `N files already formatted`.

- [ ] **Final commit:**

```bash
git add -A
git commit -m "chore: final cleanup — all tests pass, lint clean, typecheck clean"
```

---

## Execution choice

Plan saved. Two options:

**1. Subagent-Driven (recommended)** — Fresh Sonnet subagent per task, I review between tasks, fast parallel iteration on independent tasks.

**2. Inline Execution** — Execute in this session using `superpowers:executing-plans`, batch with checkpoints.

Which approach?

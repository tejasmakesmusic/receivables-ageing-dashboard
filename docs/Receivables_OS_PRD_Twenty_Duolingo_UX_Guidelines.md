# Receivables OS - Refined Product & Technical Requirements Document

**Document status:** Complete draft for build, UAT, production hardening, UI design handoff, and engagement UX guidelines
**Version:** 1.3
**Last updated:** 6 May 2026
**Product:** Receivables OS / AR Ageing Dashboard
**Primary users:** Finance Analysts, CFO, Finance Admins
**Initial entities:** India and UAE
**Assumed stack from source document:** Next.js, React, Prisma, Neon PostgreSQL, Vercel, Resend, S3/R2-compatible object storage

---

## Document Control

| Field | Value |
|---|---|
| Purpose | Convert the draft PDF into a clean, implementation-ready PRD and technical specification. |
| Source cleanup performed | Removed chat transcript fragments, duplicate PRD sections, repeated roadmap blocks, `None` artifacts, partial code snippets, and incomplete out-of-scope text. |
| Completion performed | Added launch definition, assumptions, data rules, API contracts, UAT plan, RACI, operational runbooks, monitoring plan, release checklist, rollback plan, and open decision register. |
| Design update | Added a Twenty CRM-inspired design language, screen model, token map, component behavior, accessibility rules, and Storybook handoff requirements. |
| Engagement UX update | Added Duolingo-inspired habit loops, task progress patterns, notification guidelines, and guardrails for finance-grade gamification. |
| Working assumption | Core product logic exists, but production hardening and validation are still launch blockers. |
| Recommended launch mode | Soft launch with one entity, two-cycle Excel parallel run, then UAE rollout after stability check. |

---

## Contents

1. Executive Summary
2. Current Assessment
3. Product Scope
4. Personas and Permissions
5. Operating Model
6. Core Business Rules
7. Functional Requirements
8. Non-Functional Requirements
9. Design Language, UI Specification, and Engagement UX
10. Prioritization
11. Technical Architecture
12. Data Model
13. State Machines
14. API Contract Summary
15. Reporting Specification
16. Testing and UAT Plan
17. Production Readiness Checklist
18. Monitoring and Runbooks
19. Release Roadmap
20. Implementation Work Breakdown
21. RACI
22. Risks and Mitigations
23. Assumptions, Dependencies, and Open Decisions
24. Agentic Development Appendix
25. Final Launch Gate
26. Immediate Next Actions
27. Appendix A - Cleanup Notes From Source PDF
28. Appendix B - External Design References

---

## 1. Executive Summary

Receivables OS is a finance operations platform for uploading accounts receivable data from Tally, Xero, or Excel workbooks, normalizing party names, calculating ageing, generating collection tasks, tracking promises to pay and disputes, reconciling dashboard AR against accounting-system balances, and sending CFO digests.

The product is close to usable internally, but it should not be treated as production-ready until authentication, email infrastructure, workbook retention, backups, monitoring, UAT, and security controls are completed. The current best launch path is a controlled internal production release rather than a big-bang rollout.

### 1.1 Product Vision

Give finance teams one reliable AR workspace that replaces manual Excel ageing trackers, improves collection discipline, and gives leadership real-time visibility into overdue exposure across entities.

### 1.2 Business Goals

| Goal | Target |
|---|---:|
| Reduce Days Sales Outstanding | 30% reduction from baseline within 6 months |
| Reduce manual AR tracker work | From 20+ hours/week to under 8 hours/week |
| Improve 90+ day collection focus | 40% improvement in actioned high-risk invoices |
| Improve leadership visibility | Daily dashboard plus approved CFO digest |
| Improve auditability | 100% of material mutations written to audit log |

### 1.3 Launch Thesis

Receivables OS should first launch as an internal finance operations tool, not as an external customer-facing portal. The MVP must prove that weekly snapshots, ageing, tasks, promises, disputes, reconciliations, and CFO reporting are accurate and trusted before adding customer reminders, payment links, predictive analytics, or self-service portals.

---

## 2. Current Assessment

### 2.1 What Appears Built

The source document indicates the following capabilities are either built or substantially designed:

- AR workbook upload from Tally, Xero, and Excel.
- Party name matching and alias resolution.
- Ageing bucket calculation.
- Collection task management with priority scoring.
- Promise-to-pay tracking.
- Dispute case workflow.
- Multi-entity support for India and UAE.
- Dashboard and Excel exports.
- AR reconciliation against actual closing AR.
- CFO digest email workflow.
- Audit log and role-based access control.

### 2.2 What Blocks Production

| Area | Gap | Launch impact |
|---|---|---|
| Authentication | Production Google Workspace OAuth not configured | No secure production launch |
| Email | Resend and DNS authentication not configured | CFO digest and reminders may fail or land in spam |
| Workbook retention | Uploaded files not persisted to object storage | Audit gap and data-loss risk |
| Cron security | `CRON_SECRET` missing | Unauthorized job trigger risk |
| Backups | No documented restore process | Financial data recovery risk |
| Monitoring | No Sentry/analytics/alerting plan | Failures may go unnoticed |
| Test coverage | Unit tests exist but coverage is insufficient | Regression risk in parser, ageing, RBAC, and workflows |
| UAT | No real-data validation completed | Accuracy risk before finance adoption |
| Runbooks | No operational documentation | Support and incident handling risk |

### 2.3 Recommendation

Treat the system as **70-75% complete**: the domain design is solid, but production hardening is not optional. Do not add predictive analytics, client portals, or payment gateways before fixing authentication, storage, email deliverability, backup/restore, testing, and UAT.

---

## 3. Product Scope

### 3.1 MVP Scope

The MVP must support the full internal AR operating cycle:

1. Upload AR snapshot.
2. Stage and validate workbook rows.
3. Resolve party, FX, duplicate, and parse warnings.
4. Publish point-in-time AR snapshot.
5. Calculate due dates, ageing buckets, and INR exposure.
6. Generate prioritized collection tasks.
7. Track follow-ups, promises to pay, and disputes.
8. Reconcile dashboard AR against accounting-system closing AR.
9. Export Excel ageing reports.
10. Generate CFO digest through an approval workflow.
11. Preserve audit history and uploaded workbook evidence.

### 3.2 Explicit Non-MVP Scope

The following items are valuable, but should not block the first production release:

- Customer-facing portal.
- Payment gateway integration.
- SMS reminders.
- Predictive late-payment scoring.
- Direct Tally/Xero API pulls.
- White-labeling.
- Full multi-language support.
- Custom workflow builder.
- Automated legal collections.

### 3.3 Out of Scope for This Product

- Full ERP replacement.
- Accounts Payable management.
- General ledger reconciliation.
- Payroll.
- Inventory tracking.
- Tax filing automation.
- Bank reconciliation.
- Statutory compliance filing.

---

## 4. Personas and Permissions

### 4.1 Personas

| Persona | Role | Primary needs | Key workflows |
|---|---|---|---|
| Priya | Finance Analyst / AR Collections Specialist | Upload AR, resolve warnings, work collection tasks, log calls, promises, and disputes | Weekly snapshot upload, task execution, ageing export |
| Rajesh | CFO | Cross-entity visibility, high-risk parties, DSO trends, digest summaries | Dashboard review, CFO digest, exception review |
| Amit | Finance Admin / Finance Ops Manager | Configure users, parties, credit days, email rules, FX rates, and audit review | User approval, party cleanup, configuration, reconciliation oversight |

### 4.2 Role Model

| Role | Data access | Mutations allowed | Notes |
|---|---|---|---|
| PENDING | None except own profile | None | Newly authenticated user awaiting approval |
| ANALYST | Entity-scoped | Upload, staging actions, tasks, follow-ups, promises, disputes | Cannot access other entities |
| CFO | Cross-entity read access | Approvals and review actions only, where explicitly granted | No operational task mutation by default |
| ADMIN | Cross-entity | Configuration, user management, overrides, digest approval | Emergency publish override allowed |

### 4.3 Permission Rules

- Every API route must enforce authentication.
- Every mutation must enforce role and entity scope.
- CFO role is read-mostly by default; do not quietly give CFO operational write access.
- Admin override must be explicit, reason-coded, and audit-logged.
- Party, credit-period, FX, email-rule, and user-management changes require audit logs with before/after JSON.

---

## 5. Operating Model

### 5.1 Weekly Analyst Workflow

```text
Tally/Xero export
      |
      v
Upload AR workbook
      |
      v
Stage rows and detect source
      |
      v
Resolve warnings: party, FX, duplicates, parse errors
      |
      v
Publish snapshot using as_of_date
      |
      v
Create invoice snapshots and mark missing invoices as settled
      |
      v
Generate collection tasks
      |
      v
Analyst logs calls, promises, disputes, and snoozes
      |
      v
Reconcile dashboard AR vs accounting AR
      |
      v
Export report and approve CFO digest
```

### 5.2 CFO Workflow

1. Receive approved digest at 9:00 AM IST on working days.
2. Review total AR, 90+ AR, top overdue parties, broken promises, escalated disputes, and reconciliation status.
3. Drill into party details only when an exception needs attention.
4. Use dashboard trends to challenge collection plan and DSO movement.

### 5.3 Admin Workflow

1. Approve new users and assign roles/entities.
2. Maintain party aliases and canonical party records.
3. Maintain credit-period rules.
4. Maintain FX rates and entity defaults.
5. Review audit logs and digest approvals.
6. Handle override publish only when blocked data is understood and documented.

---

## 6. Core Business Rules

### 6.1 Snapshot Rule

All ageing, exposure, and reporting must be calculated from the snapshot `as_of_date`, not from the system date at page load. This prevents dashboard numbers from drifting after a snapshot is published.

### 6.2 Due Date Rule

Due date must be calculated as:

```text
invoice_date + applicable_credit_days
```

Do not trust the accounting export's overdue status as the system-of-record for ageing. Accounting exports can be inconsistent across formats and report dates.

### 6.3 Credit Days Precedence

Use this precedence order:

1. Party-level credit period configuration for the entity and effective date.
2. Uploaded credit-period workbook value, once approved.
3. Entity default credit days.
4. Admin override with reason, if no configuration exists.

### 6.4 Ageing Buckets

| Bucket | Rule |
|---|---|
| NOT_DUE | `as_of_date <= due_date` |
| 0-30 | 1 to 30 days overdue |
| 31-60 | 31 to 60 days overdue |
| 61-90 | 61 to 90 days overdue |
| 90+ | More than 90 days overdue |

### 6.5 FX Rule

- Store original currency and amount.
- Store INR converted amount at the invoice snapshot level.
- Pin FX rate by invoice date or configured effective-date rule.
- Missing FX for non-INR invoices should block publish unless Admin applies an override.
- Default rate of 1.0 is valid only when source and target currency are both INR.

### 6.6 Settlement Rule

If an invoice existed in the previous published snapshot for the same entity/source but is absent from the new published snapshot, mark it as `SETTLED`, subject to reconciliation review. Do not mark invoices settled during staging.

### 6.7 Duplicate Invoice Rule

Invoice uniqueness should be enforced on:

```text
entity_id + source_system + invoice_number + party_id
```

Where invoice numbers are not reliable, add a fallback hash using invoice number, invoice date, party name, amount, currency, and source row metadata.

### 6.8 Reconciliation Rule

Dashboard AR must reconcile to accounting closing AR at the snapshot level.

```text
reconciliation_delta = accounting_closing_ar - dashboard_snapshot_ar
```

Recommended threshold:

- Absolute tolerance: INR 1,000 for normal noise.
- Materiality tolerance: configurable percentage, default 0.5% of total AR.
- Status: `MATCHED`, `MISMATCHED`, or `WAIVED_WITH_REASON`.

---

## 7. Functional Requirements

### 7.1 Upload and Data Ingestion

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-1.1 | Upload Tally AR Excel export | MUST | Parser detects expected Tally headers and extracts party, invoice number, invoice date, amount, currency, and outstanding amount. |
| F-1.2 | Upload Xero AR Excel export | MUST | Parser maps all required Xero fields to canonical schema. |
| F-1.3 | Upload credit-period config | MUST | Parser creates or updates credit-period records per entity/party/effective date. |
| F-1.4 | Auto-detect workbook source | MUST | System identifies Tally, Xero, or credit-period workbook without manual source selection. |
| F-1.5 | Stage parse errors | MUST | Invalid rows are retained with `PARSE_ERROR`; rows are never silently dropped. |
| F-1.6 | Fuzzy party matching | MUST | Aliases resolve likely party matches; confidence score and warnings are visible. |
| F-1.7 | Manual party mapping | MUST | Analyst can map an unmapped source name to a canonical party. |
| F-1.8 | Preview staged data | MUST | Staging screen shows valid rows, warnings, parse errors, and excluded rows. |
| F-1.9 | Warning acknowledgement gate | MUST | Publish is blocked until all warnings are resolved, excluded, or acknowledged. |
| F-1.10 | Original workbook retention | MUST | Uploaded file stored in object storage with hash, uploader, entity, snapshot, and timestamp. |
| F-1.11 | Bulk warning actions | SHOULD | Analyst can apply the same party mapping or acknowledgement to selected rows. |

### 7.2 Ageing and Snapshot Calculation

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-2.1 | Calculate due date from credit days | MUST | Due date equals invoice date plus applicable credit days. |
| F-2.2 | Calculate ageing by snapshot date | MUST | Ageing buckets use `as_of_date`, not today's date. |
| F-2.3 | Convert to INR | MUST | INR amount uses pinned FX rate and is stored for auditability. |
| F-2.4 | Missing FX handling | MUST | Non-INR missing FX blocks publish unless Admin override is recorded. |
| F-2.5 | Mark settled invoices | MUST | Missing invoices in new snapshot are marked settled after publish. |
| F-2.6 | Preserve point-in-time AR | MUST | `invoice_snapshots` stores amount outstanding and ageing bucket for each published snapshot. |

### 7.3 Collections Workflow

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-3.1 | Auto-create collection tasks | MUST | Tasks created after publish for 90+ invoices, high-value exposure, broken promises, disputes, and stale follow-ups. |
| F-3.2 | Priority scoring | MUST | Priority score from 0-100 is calculated from age, value, broken promises, dispute status, and follow-up staleness. |
| F-3.3 | Task state machine | MUST | Task can move through `OPEN`, `IN_PROGRESS`, `SNOOZED`, `COMPLETED`, `CANCELLED` with enforced transitions. |
| F-3.4 | Assign tasks | MUST | Analyst can assign task to self or same-entity teammate; Admin can assign across entities. |
| F-3.5 | Snooze tasks | MUST | Snoozed task reopens automatically on `snooze_until`. |
| F-3.6 | Log follow-ups | MUST | Contact method, contact person, notes, timestamp, invoice, party, and user are stored. |
| F-3.7 | Record promise to pay | MUST | Amount, currency, promised date, contact person, notes, and creator are stored. |
| F-3.8 | Promise status | MUST | PTP state moves through `OPEN`, `KEPT`, `BROKEN`, `CANCELLED`. |
| F-3.9 | Raise dispute | MUST | Reason code, notes, expected resolution date, owner, and status are captured. |
| F-3.10 | Dispute lifecycle | MUST | Dispute moves through `OPEN`, `INVESTIGATING`, `ESCALATED`, `RESOLVED`, `CANCELLED`; resolved cases require resolution note. |
| F-3.11 | Bulk task operations | SHOULD | Analysts can bulk assign, snooze, or update selected tasks. |

### 7.4 Dashboard and Reporting

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-4.1 | Consolidated dashboard | MUST | CFO can view India and UAE in one view. |
| F-4.2 | Entity dashboard | MUST | Analyst sees only assigned entity data. |
| F-4.3 | Ageing distribution | MUST | Dashboard shows total AR by ageing bucket. |
| F-4.4 | Top overdue parties | MUST | Table sorted by 90+ overdue exposure. |
| F-4.5 | Party detail | MUST | Shows invoices, follow-ups, promises, disputes, and outstanding exposure for one party. |
| F-4.6 | Invoice detail | MUST | Shows source, snapshots, follow-ups, disputes, PTPs, and audit events. |
| F-4.7 | Excel export | MUST | Generates formatted ageing report with entity, party, bucket, and subtotals. |
| F-4.8 | Dynamic filters | SHOULD | Users can filter by entity, party, bucket, date, dispute status, task owner, and priority. |
| F-4.9 | PDF board report | SHOULD | Generates CFO-ready PDF report after UAT stabilization. |

### 7.5 Reconciliation

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-5.1 | Enter closing AR | MUST | Admin can enter accounting-system closing AR for snapshot/entity. |
| F-5.2 | Compare dashboard vs accounting AR | MUST | System calculates delta and status. |
| F-5.3 | Mismatch alert | MUST | Dashboard banner appears when delta exceeds threshold. |
| F-5.4 | Reconciliation history | MUST | Each reconciliation stores reviewer, timestamp, values, delta, status, and notes. |
| F-5.5 | Waiver with reason | SHOULD | Admin can waive immaterial mismatch with mandatory note. |

### 7.6 Email and Notifications

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-6.1 | CFO digest | MUST | Digest includes total AR, 90+ exposure, top 5 parties, reconciliation status, broken promises, and escalated disputes. |
| F-6.2 | Digest approval | MUST | Admin can approve, skip, or hold digest before send. |
| F-6.3 | Email rules | MUST | Admin can enable/disable email types and configure recipients. |
| F-6.4 | Email outbox | MUST | Emails are queued, retried, and tracked with delivery status. |
| F-6.5 | Customer reminders | SHOULD | Payment reminders can be triggered from approved templates after legal/business approval. |
| F-6.6 | Analyst reminders | SHOULD | Analyst receives reminder when snoozed task reopens or PTP breaks. |

### 7.7 Admin and Configuration

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-7.1 | User approval | MUST | Admin approves users and assigns role/entity access. |
| F-7.2 | Party aliases | MUST | Admin can create, edit, merge, and deactivate aliases. |
| F-7.3 | Credit period config | MUST | Admin can set credit days by party/entity/effective date. |
| F-7.4 | FX rates | MUST | Admin can manage FX rates by currency and effective date. |
| F-7.5 | Exception tags | SHOULD | Admin can define exception categories such as Legal, Disputed, Management Hold. |
| F-7.6 | Audit viewer | MUST | Admin can search audit events by user, entity, action, entity type, and date. |
| F-7.7 | Override publish | MUST | Admin override requires reason and writes audit log. |

### 7.8 Security and Compliance

| ID | Requirement | Priority | Acceptance criteria |
|---|---|---|---|
| F-8.1 | RBAC | MUST | `PENDING`, `ANALYST`, `CFO`, and `ADMIN` permissions enforced on API and UI. |
| F-8.2 | Entity scope | MUST | Analysts cannot read or mutate other-entity data. |
| F-8.3 | Audit trail | MUST | Every material mutation writes before/after JSON, actor, timestamp, and request context. |
| F-8.4 | Secure sessions | MUST | Sessions are signed, HTTP-only, secure, and expire per policy. |
| F-8.5 | API rate limiting | MUST | Standard user routes limited to 100 req/min; upload and email routes stricter. |
| F-8.6 | Data retention | SHOULD | Snapshots, workbooks, and audit logs retained for finance-approved period, recommended minimum 5 years. |
| F-8.7 | Privacy controls | SHOULD | PII fields documented; deletion/export requests handled through admin process. |

---

## 8. Non-Functional Requirements

### 8.1 Performance

| ID | Requirement | Target |
|---|---|---:|
| NFR-1 | Upload processing | Under 30 seconds for 5,000 rows |
| NFR-2 | Dashboard p95 load time | Under 2 seconds for normal filters |
| NFR-3 | Excel export | Under 10 seconds for 10,000 invoices |
| NFR-4 | Concurrent internal users | 20 users with under 3-second response |
| NFR-5 | Query pagination | All tables with over 500 rows must paginate server-side |

### 8.2 Reliability

| ID | Requirement | Target |
|---|---|---|
| NFR-6 | Uptime | 99.5% excluding planned maintenance |
| NFR-7 | Backups | Daily automated backup with 30-day retention minimum |
| NFR-8 | Restore drill | Quarterly restore test in non-production environment |
| NFR-9 | Email retry | Three retries with exponential backoff |
| NFR-10 | Data integrity | Zero silent row drops during parse/publish |

### 8.3 Scalability

| ID | Requirement | Target |
|---|---|---:|
| NFR-11 | Invoice storage | 1 million invoices |
| NFR-12 | Snapshot history | 5 years |
| NFR-13 | Entity support | 10 entities |
| NFR-14 | Upload file size | Configurable limit with clear rejection message |

### 8.4 Usability

| ID | Requirement | Target |
|---|---|---|
| NFR-15 | Onboarding | New analyst can complete first upload within 30 minutes using manual |
| NFR-16 | Accessibility | Keyboard-accessible critical workflows |
| NFR-17 | Mobile | CFO dashboard usable on iPhone 12+ portrait |
| NFR-18 | Empty/error states | Every critical screen has actionable empty and error states |

### 8.5 Security

| ID | Requirement | Target |
|---|---|---|
| NFR-19 | Authentication | Google Workspace OAuth for production |
| NFR-20 | Transport | HTTPS/TLS in production |
| NFR-21 | Data at rest | Database and object storage encryption enabled |
| NFR-22 | Secrets | Secrets stored only in environment/secret manager, never in code |
| NFR-23 | OWASP | Basic OWASP Top 10 review before launch |

---

## 9. Design Language, UI Specification, and Engagement UX

Receivables OS should use **Twenty CRM for structure** and **Duolingo for workflow motivation**.

- Twenty CRM is the structural reference: object-first records, saved views, command menu, global search, side panels, record pages, dashboards, and workflow automation.
- Duolingo is the behavioral reference: short loops, clear progress, immediate feedback, streak/freeze mechanics, gentle nudges, and habit formation.
- The final product must still feel like a finance operations system. Do not make it childish, noisy, or game-like at the expense of auditability and trust.

### 9.1 Reference Model

| Inspiration source | What to borrow | Receivables OS translation | What to avoid |
|---|---|---|---|
| Twenty CRM | Workspace shell, objects, fields, relations, saved views, side panels, command menu, dashboards, workflow triggers | Treat invoices, parties, tasks, promises, disputes, snapshots, and reconciliations as first-class records with table/list views and record pages | Do not copy Twenty branding, logos, exact visuals, or build generic CRM configurability before the AR MVP is stable |
| Duolingo | Short daily goals, visible progress, immediate completion feedback, streaks with flexibility, humane nudges | Use a `Today's Focus` queue, upload progress path, follow-up streaks, reconciliation completion milestones, and reminder nudges | Do not use manipulative retention loops, shame, cartoon-heavy UI, fake XP, or leaderboards tied to cash collected |
| Modern productivity apps | Fast command access, dense lists, saved filters, keyboard shortcuts, contextual side panels | Make common finance actions reachable in one to two steps from tables, search, or `Cmd/Ctrl+K` | Do not over-customize every screen; excess configuration will slow launch and confuse finance users |

### 9.2 Design Principles

| Principle | Application in Receivables OS | Hard rule |
|---|---|---|
| Object-first workspace | Treat invoices, parties, tasks, promises, disputes, snapshots, and reconciliations as first-class records. | Every major object must have a table/list view, side panel preview, and full record page. |
| Dense but calm | Use compact rows, muted borders, light backgrounds, and status tags instead of heavy cards. | Avoid oversized dashboard tiles that reduce row-level visibility. |
| Inline over modal-heavy | Allow inline edits for assignment, status, due date, notes, and warning resolution where safe. | Use modals only for destructive actions, approval gates, and multi-step uploads. |
| One action surface | Primary actions should sit in the page header, command menu, row actions, or side panel. | Do not scatter duplicate CTAs across unrelated places. |
| Finance-grade traceability | Any number, state, override, or warning must expose source, timestamp, actor, and audit trail. | No silent mutations and no unexplained computed totals. |
| Keyboard-ready | Search, command menu, table navigation, quick actions, and record open/close must work by keyboard. | Minimum shortcuts: `/` search, `Cmd/Ctrl+K` command menu, `Esc` close panel, `Enter` open row. |
| Habit-building, not gimmicks | Use progress and streaks to help analysts complete controllable work. | Reward follow-up discipline and reconciliation hygiene, not raw collection amount. |
| Calm urgency | Make risk visible without turning every screen red. | 90+ and broken promises deserve emphasis; normal overdue work should remain scannable, not alarming. |

### 9.3 Visual Foundation

Use Twenty's neutral-light system as the base, then layer finance-specific semantic colors for AR risk.

| Token group | Twenty-inspired direction | Receivables OS decision |
|---|---|---|
| Typeface | Inter or similar modern sans-serif | Use Inter for the application UI. For exported Excel/PDF reports, use Aptos/Calibri fallback if Inter is unavailable. |
| Font sizes | Compact scale: xxs, xs, sm, md, lg, xl, xxl | Use `12-14px` for tables, `14px` for body/forms, `16-20px` for section titles, and `24px` only for page-level titles or major metrics. |
| Weights | Regular 400, medium 500, semi-bold 600 | Use 500 for table headers and labels; reserve 600 for page titles, metric values, and active navigation. |
| Radius | Small to medium, pill for tags | Use 8px for cards/inputs, 4px for table controls, pill radius for status tags, and 20px only for larger empty-state containers. |
| Surfaces | White primary, near-white secondary, light grey tertiary | Keep most screens white/near-white. Use subtle grey panels for sidebars, filters, staging warnings, and grouped table sections. |
| Borders | Light grey dividers | Prefer 1px borders over shadows. Use shadows only for floating menus, command palette, and side panels. |
| Motion | Minimal | Keep transitions below 150ms. Use animation only for progress confirmation, not decoration. |

### 9.4 Core Color Tokens

Use these as practical neutral tokens when not importing Twenty UI tokens directly.

| Use | Token | Approx. color | Notes |
|---|---|---|---|
| Page background | `background.primary` | `#FFFFFF` | Main work area. |
| Subtle app background | `background.secondary` | `#FCFCFC` | Sidebar, filter panels, upload staging container. |
| Grouped section background | `background.tertiary` | `#F1F1F1` | Table grouping, low-emphasis chips. |
| Default border | `border.light` | `#F1F1F1` | Thin separators and card outlines. |
| Medium border | `border.medium` | `#EBEBEB` | Inputs, table grid, disabled controls. |
| Strong border | `border.strong` | `#D6D6D6` | Active table cell, focused row, panel divider. |
| Primary text | `font.primary` | `#333333` | Main content and amounts. |
| Secondary text | `font.secondary` | `#666666` | Metadata, timestamps, helper copy. |
| Tertiary text | `font.tertiary` | `#999999` | Empty states, muted labels. |
| Disabled text | `font.light` | `#B3B3B3` | Disabled controls only. |

### 9.5 Finance Semantic Colors

Color must support, not replace, labels. Every badge needs text because finance users will export screenshots, print reports, and work under poor display conditions.

| State | Badge label | Color direction | Usage |
|---|---|---|---|
| Not due | `NOT DUE` | Neutral grey | Invoice not actionable yet. |
| 0-30 overdue | `0-30` | Blue/info | Mildly overdue. |
| 31-60 overdue | `31-60` | Amber/warning | Watchlist. |
| 61-90 overdue | `61-90` | Orange/high warning | Escalate if high value. |
| 90+ overdue | `90+` | Red/danger | Collection priority and CFO visibility. |
| Settled | `SETTLED` | Green/success | Invoice no longer outstanding. |
| Promise open | `PTP OPEN` | Blue/info | Promise is active. |
| Promise broken | `PTP BROKEN` | Red/danger | Auto-raise priority. |
| Dispute open | `DISPUTE` | Violet/purple | Amount or validity is blocked. |
| Reconciliation matched | `MATCHED` | Green/success | Dashboard AR equals accepted accounting balance. |
| Reconciliation mismatch | `MISMATCH` | Red/danger | Delta exceeds threshold and needs explanation. |
| Admin override | `OVERRIDE` | Amber with audit icon | Must link to actor and reason. |

### 9.6 App Shell and Navigation

Use a persistent left navigation and object shortcuts, mirroring Twenty's workspace pattern.

| Navigation item | Route | Object/view type | Notes |
|---|---|---|---|
| Dashboard | `/dashboard` | Dashboard grid | CFO and Analyst summary by role/entity. |
| Focus Queue | `/focus` | Prioritized work queue | Duolingo-style daily loop for controllable analyst actions. |
| Snapshots | `/snapshots` | Object table | Upload history, staged/published/failed status. |
| Invoices | `/invoices` | Object table | Default operational table; supports saved views. |
| Parties | `/parties` | Object table + record pages | Canonical party master and alias management. |
| Tasks | `/tasks` | Table + Kanban | Table default; Kanban optional by task status. |
| Promises | `/promises-to-pay` | Table + Calendar | Calendar view by promised date. |
| Disputes | `/disputes` | Table + Kanban | Kanban by dispute state for escalation management. |
| Reconciliation | `/reconciliation` | Workflow page | Snapshot-level reconciliation and history. |
| Reports | `/reports` | Export center | Ageing exports, CFO reports, audit exports. |
| Admin | `/admin` | Settings workspace | Users, entities, credit days, FX, email rules, audit. |

Navigation rules:

1. Analysts see only their entity-scoped objects and views.
2. CFOs see cross-entity dashboard and read-only object views.
3. Admins see configuration, audit, and override tools.
4. PENDING users see only an access-pending screen.
5. Favorites should support saved operational views like `90+ High Value`, `Broken PTP`, `Unmapped Parties`, `Reconciliation Mismatches`, and `Due Today`.

### 9.7 Twenty-Inspired Functional Patterns to Borrow

| Twenty pattern | Receivables OS equivalent | Build priority | Acceptance criteria |
|---|---|---|---|
| Objects and fields | Invoices, parties, snapshots, tasks, promises, disputes, reconciliations | MUST | Each object has a canonical schema, API route, list view, detail page, and audit behavior. |
| Relations | Party-to-invoices, invoice-to-task, invoice-to-promise, invoice-to-dispute | MUST | Related records appear in side panels and full record pages without leaving context. |
| Saved views | `90+`, `Broken PTP`, `My Tasks`, `Unmapped Parties`, `Mismatch Snapshots` | MUST | Views store filters, sorting, visible columns, grouping, and owner/shared state. |
| Table view | Invoice and task operating views | MUST | Supports grouping, column visibility, sticky identity columns, bulk actions, and inline safe edits. |
| Kanban view | Task status and dispute status boards | SHOULD | Dragging cards changes state only when state-machine rules allow it. |
| Calendar view | Promise dates and snooze dates | SHOULD | Shows due today, overdue, and upcoming promises with drilldown. |
| Side panel | Quick record preview and action panel | MUST | Row click opens side panel; `Open full page` deep-links to the complete record. |
| Command menu | `Cmd/Ctrl+K` quick actions | MUST | Can search records and trigger major workflows without page navigation. |
| Dashboard widgets | CFO and analyst dashboard grid | MUST | Widgets are filterable by entity/as-of date and support drilldown to source records. |
| Workflow triggers | Digest, PTP monitor, snooze reopen, reminders | SHOULD | Triggered actions write audit entries and are visible in operational logs. |
| Import/export | Workbook upload and Excel export | MUST | Upload, parse, stage, publish, export, and audit evidence are connected. |
| Soft delete recovery | Restore mistaken records or mappings | COULD | Deleted or merged objects remain auditable and recoverable by Admin where safe. |

### 9.8 Command Menu and Global Search

Receivables OS should include a `Cmd/Ctrl+K` command menu because finance users repeat the same actions daily.

| Command | User roles | Behavior |
|---|---|---|
| Upload AR Snapshot | Analyst, Admin | Opens upload flow. |
| Open Today's Focus | Analyst, Admin | Opens priority queue with due follow-ups, 90+ high value, broken promises, and staging blockers. |
| Search Invoice | Analyst, CFO, Admin | Searches by invoice number, party, amount, and status within scope. |
| Search Party | Analyst, CFO, Admin | Opens party side panel or full record. |
| Create Collection Task | Analyst, Admin | Opens side panel form with entity and party prefill when context exists. |
| Log Follow-up | Analyst, Admin | Requires party or invoice context. |
| Record Promise to Pay | Analyst, Admin | Requires amount, promised date, contact, and invoice/party link. |
| Raise Dispute | Analyst, Admin | Requires reason code and expected resolution date. |
| Export Ageing Report | Analyst, CFO, Admin | Opens export options with current filters pre-applied. |
| Approve CFO Digest | Admin | Available only when digest is queued for approval. |
| Open Audit Log | Admin | Opens audit viewer. |

Search behavior:

- `/` focuses global search.
- Results are grouped by object: invoices, parties, tasks, promises, disputes, snapshots.
- Each result shows object type, primary label, secondary metadata, status badge, and amount where applicable.
- Cross-entity results show entity badges; entity-scoped users never see inaccessible records.

### 9.9 Screen-Level Design Requirements

| Screen | Twenty-style pattern | Duolingo-style pattern | Receivables OS adaptation | Primary action |
|---|---|---|---|---|
| Dashboard | Widget grid | Clear progress summary | Metrics, ageing distribution, top overdue parties, broken promises, disputes, reconciliation status | Export / Approve digest |
| Focus Queue | Object view | Daily goal loop | Prioritized set of controllable tasks: follow-ups, broken promises, warning resolution, reconciliation actions | Start focus session |
| Snapshot Upload | Multi-step flow | Progress path | Upload, parse, stage, resolve warnings, publish, reconcile | Upload workbook |
| Staging Review | Dense table view | Completion checklist | Inline mapping, warning chips, source row visibility, publish gate | Publish snapshot |
| Invoices | Object table | Saved focus path | Saved views, grouping, filters, inline actions, row side panel | Export ageing |
| Party Detail | Record page | Next best action | Summary, invoices, follow-ups, promises, disputes, files, audit timeline | Log follow-up |
| Task Workspace | Object table + side panel | Short task loop | Priority queue with quick assignment, snooze, complete, PTP/dispute actions | Bulk assign |
| Promise Calendar | Calendar/table hybrid | Due-today reminders | Upcoming, due today, broken, kept promises | Record promise |
| Dispute Board | Kanban/list hybrid | Escalation path | Open, investigating, escalated, resolved | Raise dispute |
| Reconciliation | Workflow page | Match/mismatch completion feedback | Dashboard AR vs actual AR, delta reason capture, approval history | Submit reconciliation |
| Admin Settings | Settings workspace | Setup checklist | Users, entities, parties, aliases, credit days, FX, email rules, audit | Save configuration |

### 9.10 Table and Record Interaction Model

Tables are the dominant UI surface. They should feel closer to Twenty's spreadsheet-style object views than to static admin tables.

| Pattern | Requirement |
|---|---|
| Saved views | Each object supports public and private saved views with filters, sort, visible columns, grouping, and pinned state. |
| Inline edit | Safe fields can be edited inline: assigned user, task status, snooze date, follow-up notes, warning mapping, tags. Financial computed fields are read-only. |
| Row side panel | Clicking a row opens a right-side panel with summary, key fields, recent activity, and context actions. |
| Full record page | `Open full page` expands to full detail with tabs/widgets. |
| Bulk action bar | Selecting rows opens a sticky bulk bar: assign, snooze, tag, export, acknowledge warnings, or mark reviewed. |
| Frozen identity columns | Invoice number, party, ageing bucket, and amount should remain visible on horizontal scroll. |
| Audit affordance | Mutated fields show `last updated`, actor, and audit link in detail views. |
| Empty state | Empty states must include a next action, not just a message. Example: `No broken promises - view open promises`. |
| Next action footer | Side panels should show the safest next action: log follow-up, record PTP, raise dispute, snooze, or complete. |

### 9.11 Duolingo-Inspired Engagement UX

Apply engagement mechanics only to **controllable operating behaviors**. They should make disciplined AR work easier, not manipulate analysts or distort finance priorities.

| Mechanic | Receivables OS version | Purpose | Guardrail |
|---|---|---|---|
| Daily goal | `Today's Focus`: configurable target such as 10 priority follow-ups, 5 warning resolutions, or 1 reconciliation review | Reduces overwhelm and gives analysts a clear finish line | Goals are configurable by role/entity and never tied to cash collected |
| Progress path | Upload journey: Upload -> Parse -> Review -> Resolve -> Publish -> Reconcile | Makes multi-step work visible and reduces anxiety during uploads | Every step must show what changed and what remains blocked |
| Streak | On-time follow-up streak for completing due follow-ups within SLA | Builds collection discipline | Include weekend/holiday handling and manager-approved freeze days |
| Streak freeze | Leave, public holiday, finance close, or system outage freeze | Prevents demotivation from unavoidable missed days | Freeze is logged and not treated as failure or hidden gaming |
| Immediate feedback | After logging a follow-up, show task state update, next reminder date, and priority score change | Confirms that the action was recorded | Feedback must include audit-safe facts, not vague praise only |
| Milestones | `All 90+ reviewed`, `Snapshot published`, `Reconciliation matched`, `No broken promises due today` | Provides closure on recurring workflows | Keep tone professional; no confetti for financial risk events |
| Gentle nudges | Promise due today, stale follow-up, digest awaiting approval, unmatched reconciliation | Pulls users back to work that matters | Nudges must be actionable and snoozable; no guilt copy |
| Progressive onboarding | First-run checklist for upload, staging review, task handling, PTP, dispute, reconciliation, export | Helps new analysts learn by doing | Checklist disappears or collapses after completion |
| Adaptive focus | Queue suggests the next 5-10 highest-impact actions | Prevents decision fatigue | Ranking formula must be explainable and adjustable by Admin |

### 9.12 Gamification Guardrails

| Decision | Rule |
|---|---|
| What can be rewarded | Follow-ups completed on time, promises reviewed, staging warnings resolved, reconciliations submitted, disputes updated, exports generated for review. |
| What must not be rewarded | Money collected, customers pressured, invoices closed without evidence, overrides used, or disputes suppressed. |
| Leaderboards | Avoid individual leaderboards for collections. If used, show team-level SLA health only. |
| Tone | Use calm copy: `Nice - all due follow-ups are logged.` Avoid childish or coercive copy. |
| Failure states | Show next step, not shame. Example: `3 promises need review today` instead of `You lost your streak`. |
| Streak flexibility | Support holidays, weekends, leave, and system downtime. Finance operations should not punish legitimate absence. |
| Transparency | Engagement stats must be visible but secondary to business data and audit trail. |
| Privacy | Do not expose analyst performance metrics broadly without role-based approval. |

### 9.13 Core UX Loops

| Loop | User | Trigger | Steps | Success state |
|---|---|---|---|---|
| Daily focus loop | Analyst | Start of day or login | Open Focus Queue -> work top tasks -> log follow-up/PTP/dispute -> snooze/complete -> review progress | Due follow-ups completed and new promises/disputes logged |
| Weekly snapshot loop | Analyst/Admin | New Tally/Xero export | Upload -> stage -> resolve warnings -> publish -> generate tasks -> reconcile | Snapshot published, warnings resolved, dashboard refreshed |
| Promise discipline loop | Analyst | Promise due today or overdue | Open promise -> verify payment status -> mark kept/broken/cancelled -> create next task if needed | No unreviewed due promises |
| CFO glance loop | CFO | Morning dashboard/digest | View total AR -> scan 90+ -> inspect top parties -> check broken promises/disputes -> ask for action | CFO understands exposure in under 60 seconds |
| Admin hygiene loop | Admin | Weekly master-data review | Review aliases, credit days, FX, users, email rules, audit anomalies | Configuration remains clean and auditable |

### 9.14 UX Writing, Empty States, and Notifications

| Situation | Copy rule | Example |
|---|---|---|
| Success after action | Confirm the record and next state. | `Follow-up logged. Task snoozed until 16 Dec 2026.` |
| Warning | Explain risk and fix. | `FX rate missing for USD on invoice date. Add rate or exclude row before publish.` |
| Error | State what failed and what the user can do. | `Workbook parsed, but 12 rows have missing invoice dates. Download error rows or edit staging data.` |
| Empty state | State why it is empty and offer next action. | `No broken promises due today. View open promises.` |
| Nudge | Be specific and snoozable. | `5 promises are due today. Review now or snooze this reminder for 2 hours.` |
| CFO digest | Use concise business language. | `90+ exposure increased by ₹12.4L since last snapshot. Top driver: ABC Pvt Ltd.` |
| Admin override | Require reason and show consequence. | `Publishing with unresolved warnings may affect ageing accuracy. Enter override reason.` |

### 9.15 Component Specification

| Component | Usage | States to design/build |
|---|---|---|
| Button | Primary workflow actions and secondary table actions | Default, hover, active, loading, disabled, destructive. |
| Icon button | Row actions, quick open, copy invoice number, view audit | Default, hover, tooltip, disabled. |
| Text input | Search, forms, filters | Empty, focused, filled, error, disabled. |
| Select/combobox | Entity, party, assignee, reason code, status | Loading, searchable, no results, selected, error. |
| Date picker | Snapshot date, promise date, snooze date, expected resolution | Today, past blocked where relevant, range, error. |
| Status tag | Ageing, task, PTP, dispute, reconciliation | All semantic states; do not rely on color only. |
| Data table | Invoices, tasks, parties, promises, disputes, snapshots | Loading skeleton, empty, filtered empty, error, selected rows, grouped rows. |
| Side panel | Quick record preview and forms | View mode, edit mode, unsaved changes, loading, error. |
| Modal | Publish confirmation, admin override, destructive actions | Confirm, cancel, loading, validation error. |
| Snackbar/toast | Save confirmation and non-blocking error feedback | Success, error, warning, queued retry. |
| Timeline | Follow-ups, emails, audit events, dispute notes | Dense chronology, grouped by date, actor visible. |
| Dashboard widget | Metrics and charts | Loading, no data, stale snapshot, drilldown available. |
| Progress path | Upload, onboarding, reconciliation | Not started, active, blocked, completed. |
| Focus card | Daily priority item | Open, active, snoozed, completed, blocked. |
| Nudge card | Promise due, stale task, digest approval | Active, snoozed, dismissed, escalated. |
| Goal chip | Daily/weekly completion summary | 0%, partial, complete, exceeded, frozen. |

### 9.16 Information Density Rules

| Area | Desktop target | Mobile/tablet target |
|---|---|---|
| Table row height | 36-44px | 48-56px |
| Primary table font | 13px | 14px |
| Filter chips | Single-line, horizontally scrollable if needed | Collapsible filter drawer |
| Side panel width | 420-520px | Full-screen drawer |
| Dashboard widget grid | 12-column layout | 1-column mobile, 2-column tablet |
| Header height | 48-56px | 56px |
| Focus queue batch size | 5-10 cards visible | 3-5 cards visible |

Do not over-optimize for mobile before launch. CFO read-only dashboard and party/invoice lookup should be responsive at launch; full analyst workflows can be desktop-first if that is the real finance operating environment.

### 9.17 Accessibility and Keyboard Requirements

| Area | Requirement |
|---|---|
| Contrast | Text, badges, and controls must meet WCAG AA contrast. |
| Focus | Every interactive element must show a visible focus state. |
| Keyboard | Tables, command menu, side panels, forms, modals, focus cards, and progress paths must be operable without a mouse. |
| Screen readers | Status badges expose text labels, not just colors/icons. |
| Error messaging | Validation errors appear near the field and in form summary for multi-field forms. |
| Motion | Respect reduced-motion settings. Engagement feedback must work without animation. |
| Hit areas | Mobile/tablet tap targets should be at least 44px where feasible. |
| Shortcuts | Show accelerators in tooltips and command-menu rows so power users can discover them. |

### 9.18 Storybook and Design Handoff

Every core component and finance-specific composite component must have Storybook coverage before UAT.

| Story group | Required stories |
|---|---|
| Tokens | Type scale, neutral palette, semantic states, spacing/radius examples. |
| Shell | Sidebar, command menu, global search, breadcrumbs, top action bar. |
| Tables | Invoice table, task queue, staging warnings, reconciliation history. |
| Panels | Invoice side panel, party side panel, task action panel, audit panel. |
| Workflows | Upload wizard, publish gate, admin override, CFO digest approval. |
| Engagement UX | Focus queue, progress path, goal chip, streak/freeze state, nudge card. |
| States | Loading, empty, error, no permission, stale data, unsaved changes, frozen streak. |

Acceptance criteria:

1. Designers and engineers agree on token names before build.
2. Storybook includes light theme before launch; dark theme can be deferred.
3. All finance semantic states are represented as reusable tags.
4. Every table has loading, empty, error, and selected-row states.
5. Publish, override, dispute, promise, and reconciliation flows include validation-error states.
6. Focus Queue, nudge, and progress components include success, blocked, snoozed, and empty states.
7. Screenshots from Storybook are usable in UAT documentation.

### 9.19 Launch UI Bar

The first production release must feel finished in the areas finance users touch daily. The UI launch bar is:

| Area | Launch bar |
|---|---|
| Dashboard | CFO can understand AR exposure in under 60 seconds. |
| Focus Queue | Analyst can start the day with a clear, bounded set of priority actions. |
| Snapshot staging | Analyst can resolve warnings without leaving the table. |
| Invoices | Analyst can filter to actionable invoices in two clicks or one saved view. |
| Tasks | Analyst can bulk assign and work through a priority queue without page reloads. |
| Party detail | Analyst can see all context before calling a party. |
| Progress feedback | Uploads, promises, and reconciliations show clear completion/blocked states. |
| Audit | Admin can answer who changed what and when. |
| Mobile | CFO can read dashboard and party/invoice detail on phone; analyst deep workflows may remain desktop-first. |

---

## 10. Prioritization

### 10.1 Must Have - Launch Blockers

| Feature | Why it matters | Effort | Risk |
|---|---|---:|---|
| Production Google OAuth | No secure launch without real auth | 2 days | Low |
| Environment variables | Required for auth, email, storage, cron, DB | 1 day | Low |
| Resend + SPF/DKIM | Digest email workflow depends on deliverability | 3 days | Medium |
| S3/R2 workbook storage | Needed for evidence and audit trail | 2 days | Low |
| Cron secret | Prevents unauthorized cron execution | 0.5 day | Low |
| Sentry/error tracking | Required to detect production failures | 1 day | Low |
| Vercel analytics/monitoring | Required for performance and usage visibility | 1 day | Low |
| Backup and restore plan | Financial data cannot be unrecoverable | 2 days | Medium |
| Rate limiting | Reduces accidental abuse and brute-force risk | 2 days | Low |
| UAT with real data | Validates parser, ageing, reconciliation, and workflows | 1 week | High |
| Basic user manual | Required for adoption | 3 days | Low |
| Rollback plan | Required before first production deployment | 2 days | Medium |

### 10.2 Should Have - Post-Launch Priority

| Feature | Business value | Priority |
|---|---|---|
| Bulk task assignment/edit | Removes repetitive analyst clicks | High |
| Mobile CFO views | Improves leadership adoption | High |
| Payment reminder emails | Reduces manual follow-up load | High, after templates approved |
| Party merge tool | Improves data quality | Medium |
| Custom Excel exports | Supports stakeholder-specific reporting | Medium |
| Custom ageing buckets | Useful for client-specific reporting | Medium |
| Analyst task reminders | Prevents snoozed work from being missed | Medium |
| Test coverage expansion | Reduces regression risk | High |

### 10.3 Could Have - Future Enhancements

| Feature | When to consider |
|---|---|
| Predictive payment risk | After 3-6 months of clean historical data |
| Tally/Xero API integration | After manual upload workflow is stable |
| Client portal | After internal data quality is trusted |
| Payment gateway integration | After legal, finance, and customer communication policies are approved |
| Slack/Teams notifications | After email workflows are stable |
| Advanced DSO analytics | After two complete quarters of snapshots |
| Multi-currency reporting | After FX workflow passes UAT |

---

## 11. Technical Architecture

### 11.1 System Context

```text
+------------------+       +--------------------+       +--------------------+
| Finance Analysts | ----> | Receivables OS App | ----> | Neon PostgreSQL    |
+------------------+       | Next.js / Vercel   |       +--------------------+
                           |                    |
+------------------+ ----> |                    | ----> | S3/R2 Workbooks    |
| CFO / Admins     |       |                    |       +--------------------+
+------------------+       |                    |
                           |                    | ----> | Resend Email       |
+------------------+ ----> |                    |       +--------------------+
| Tally / Xero XLS |       |                    |
+------------------+       |                    | ----> | Sentry / Analytics |
                           +--------------------+       +--------------------+
```

### 11.2 Application Layers

| Layer | Responsibility |
|---|---|
| UI | Dashboard, upload, staging, tasks, party detail, invoice detail, admin console |
| API routes | Authenticated REST endpoints, request validation, RBAC, response contracts |
| Domain services | Workbook parsing, party matching, ageing, priority scoring, state transitions, report generation |
| Repositories | Prisma queries, transactions, pagination, filters |
| Data store | Users, entities, parties, invoices, snapshots, tasks, PTP, disputes, audit log, email outbox |
| External services | Google OAuth, Resend, S3/R2, Sentry, Vercel Analytics |

### 11.3 Deployment Architecture

```text
Browser
  |
  | HTTPS
  v
Vercel Edge / App Router
  |
  +--> Auth middleware and RBAC guards
  |
  +--> Route handlers and server components
  |
  +--> Prisma client with pooled Neon connection
  |
  +--> Object storage for workbooks
  |
  +--> Resend for queued emails
  |
  +--> Sentry and analytics for observability
```

### 11.4 Cron Jobs

| Job | Schedule | Purpose | Guard |
|---|---|---|---|
| Digest trigger | 9:00 AM IST, Mon-Fri | Create/queue CFO digest event | `CRON_SECRET` |
| Email processor | Every 5 minutes | Send queued emails and retry failures | `CRON_SECRET` |
| PTP monitor | Daily | Mark broken promises and create follow-up tasks | `CRON_SECRET` |
| Snooze monitor | Hourly or daily | Reopen due snoozed tasks | `CRON_SECRET` |
| Backup verification | Scheduled externally | Confirm backups exist and alert on failure | Ops monitoring |

---

## 12. Data Model

### 12.1 Core Entities

| Entity | Purpose | Key fields |
|---|---|---|
| users | System users and roles | email, full_name, role, status |
| entities | Legal/operating entities | code, name, base_currency |
| user_entity_access | Entity permission mapping | user_id, entity_id, access_level |
| parties_canonical | Clean party master | entity_id, party_name, status |
| party_aliases | Source-name mapping | party_id, alias_name, source_system, confidence |
| snapshots | Uploaded AR snapshot header | entity_id, source, as_of_date, status, uploaded_by |
| staging_rows | Parsed workbook rows before publish | snapshot_id, raw_json, parse_status, warnings |
| invoices | Invoice master | entity_id, party_id, invoice_number, invoice_date, due_date, currency |
| invoice_snapshots | Point-in-time outstanding AR | invoice_id, snapshot_id, outstanding_amount, amount_inr, ageing_bucket |
| collection_tasks | Analyst work queue | entity_id, party_id, invoice_id, status, priority_score, assigned_to |
| follow_ups | Contact/activity history | party_id, invoice_id, method, notes, created_by |
| promises_to_pay | PTP commitments | invoice_id, amount, promised_date, status |
| dispute_cases | Dispute lifecycle | invoice_id, reason_code, status, resolution_note |
| reconciliations | Snapshot vs accounting AR comparison | snapshot_id, dashboard_ar, accounting_ar, delta, status |
| fx_rates | FX configuration | from_currency, to_currency, rate, effective_date |
| email_outbox | Queue and delivery log | recipient, template, status, attempts, sent_at |
| audit_log | Immutable mutation trail | actor_id, action, entity_type, before_json, after_json |

### 12.2 Recommended Indexes

| Table | Index |
|---|---|
| invoices | `(entity_id, invoice_number)` |
| invoices | `(entity_id, party_id, status)` |
| invoice_snapshots | `(snapshot_id, ageing_bucket)` |
| invoice_snapshots | `(invoice_id, snapshot_id)` |
| collection_tasks | `(entity_id, status, priority_score)` |
| collection_tasks | `(assigned_to, status, snooze_until)` |
| promises_to_pay | `(status, promised_date)` |
| dispute_cases | `(status, entity_id)` |
| audit_log | `(entity_type, entity_id, created_at)` |
| staging_rows | `(snapshot_id, parse_status)` |

### 12.3 Audit Log Standard

Every mutation audit event should include:

```json
{
  "actor_id": "uuid",
  "action": "TASK_STATUS_CHANGED",
  "entity_type": "collection_task",
  "entity_id": "123",
  "before_json": { "status": "OPEN" },
  "after_json": { "status": "IN_PROGRESS" },
  "request_id": "req_...",
  "ip_hash": "optional",
  "created_at": "timestamp"
}
```

---

## 13. State Machines

### 13.1 Collection Task

```text
OPEN --> IN_PROGRESS --> COMPLETED
  |          |
  |          v
  |       SNOOZED --(snooze_until reached)--> IN_PROGRESS
  |
  v
CANCELLED
```

Rules:

- Any non-completed task can be cancelled with reason.
- Completed tasks cannot be reopened without Admin override.
- Snoozed tasks must have `snooze_until`.
- Every transition writes audit log.

### 13.2 Promise to Pay

```text
OPEN --> KEPT
  |
  +--> BROKEN
  |
  +--> CANCELLED
```

Rules:

- `OPEN -> KEPT` when payment evidence or analyst confirmation exists.
- `OPEN -> BROKEN` when promised date passes without settlement.
- Broken PTP increases task priority and can trigger a new task.
- Cancelled PTP requires a reason.

### 13.3 Dispute Case

```text
OPEN --> INVESTIGATING --> ESCALATED --> RESOLVED
  |             |              |
  +-------------+--------------+--> CANCELLED
```

Rules:

- Resolved disputes require `resolution_note`.
- `resolved_at` is only set on `RESOLVED`.
- Escalated disputes appear in CFO digest.
- Cancellation requires reason and audit log.

### 13.4 Snapshot

```text
UPLOADED --> STAGED --> VALIDATED --> PUBLISHED
    |           |
    |           +--> REJECTED
    v
FAILED
```

Rules:

- Publish requires at least one valid row.
- Publish blocked by unresolved parse errors.
- Publish blocked by unacknowledged warnings unless Admin override.
- Published snapshots are immutable except metadata corrections with Admin audit.

---

## 14. API Contract Summary

### 14.1 Snapshot APIs

| Endpoint | Method | Purpose | Role |
|---|---|---|---|
| `/api/snapshots` | GET | List snapshots by entity/source/status | Analyst/CFO/Admin |
| `/api/snapshots/upload` | POST | Upload workbook and create staged snapshot | Analyst/Admin |
| `/api/snapshots/{id}/staging` | GET | View staged rows and warnings | Analyst/Admin |
| `/api/snapshots/{id}/staging/actions` | POST | Map parties, exclude rows, acknowledge warnings | Analyst/Admin |
| `/api/snapshots/{id}/publish` | POST | Publish snapshot | Analyst/Admin; Admin for override |
| `/api/snapshots/{id}/reconcile` | POST | Create reconciliation record | Admin |

### 14.2 Collections APIs

| Endpoint | Method | Purpose | Role |
|---|---|---|---|
| `/api/tasks` | GET | List tasks with filters | Analyst/CFO/Admin |
| `/api/tasks/{id}` | PATCH | Update task assignment/status/snooze | Analyst/Admin |
| `/api/follow-ups` | POST | Log follow-up | Analyst/Admin |
| `/api/promises-to-pay` | POST | Create PTP | Analyst/Admin |
| `/api/promises-to-pay/{id}` | PATCH | Update PTP status | Analyst/Admin |
| `/api/disputes` | POST | Raise dispute | Analyst/Admin |
| `/api/disputes/{id}` | PATCH | Update dispute status | Analyst/Admin |

### 14.3 Reporting and Admin APIs

| Endpoint | Method | Purpose | Role |
|---|---|---|---|
| `/api/dashboard` | GET | Dashboard metrics | Analyst/CFO/Admin |
| `/api/reports/ageing.xlsx` | GET | Excel ageing export | Analyst/CFO/Admin |
| `/api/admin/users` | GET/PATCH | User approval and role management | Admin |
| `/api/admin/parties` | GET/PATCH | Party and alias management | Admin |
| `/api/admin/fx-rates` | GET/POST | FX rate maintenance | Admin |
| `/api/admin/email-rules` | GET/PATCH | Email configuration | Admin |
| `/api/admin/audit-log` | GET | Search audit log | Admin |
| `/api/cron/digest` | POST | Generate digest event | Cron only |
| `/api/cron/email-processor` | POST | Process email queue | Cron only |

### 14.4 API Standards

- All request bodies validated with schemas before business logic.
- All list endpoints support pagination, sort, and filters.
- All mutations return a standard envelope: `success`, `data`, `error`, `request_id`.
- All errors return structured codes, not only free-text messages.
- Cross-entity access failures return `403`, not filtered empty results.

---

## 15. Reporting Specification

### 15.1 CFO Digest

Digest should include:

- Total AR by entity and consolidated.
- 90+ AR by entity and consolidated.
- Ageing distribution.
- Top 5 overdue parties.
- Broken promises since prior digest.
- Escalated disputes.
- Reconciliation status for latest snapshot.
- Action items requiring CFO attention.

### 15.2 Ageing Excel Report

Required tabs:

1. Executive Summary.
2. Entity Summary.
3. Ageing by Party.
4. Invoice Detail.
5. Disputes.
6. Promises to Pay.
7. Reconciliation.
8. Data Quality Warnings.

Formatting standards:

- Freeze header row.
- Apply currency formatting.
- Use subtotals by entity and bucket.
- Include report generation timestamp and snapshot `as_of_date`.
- Include workbook source and reconciliation status.

### 15.3 Dashboard Metrics

| Metric | Definition |
|---|---|
| Total AR | Sum of outstanding amount in INR for latest published snapshot |
| 90+ AR | Sum of INR outstanding where ageing bucket is 90+ |
| High-risk parties | Parties with high 90+ exposure, broken PTPs, or escalated disputes |
| Task completion rate | Completed tasks divided by created tasks in period |
| Promise kept rate | Kept promises divided by closed promises |
| Reconciliation delta | Accounting closing AR less dashboard AR |
| Snapshot freshness | Time since latest published snapshot per entity |

---

## 16. Testing and UAT Plan

### 16.1 Automated Test Coverage

| Area | Tests required |
|---|---|
| Parser | Tally, Xero, credit-period workbooks, missing headers, malformed dates, blank rows |
| Party matching | Exact match, alias match, fuzzy match, false-positive threshold, manual override |
| Ageing | Due date, buckets, as_of_date, not-due, boundary days, leap-year dates |
| FX | Currency conversion, missing rates, effective dates, admin override |
| Publish | Valid publish, warnings blocked, errors blocked, settled invoices, idempotency |
| RBAC | Analyst own entity, analyst cross-entity denied, CFO read-only, Admin override |
| State machines | Allowed and blocked transitions for tasks, PTP, disputes, snapshots |
| Email | Outbox creation, retries, failure handling, digest content |
| Reports | Excel structure, subtotals, filters, reconciliation status |

### 16.2 E2E Test Scenarios

1. Analyst logs in and uploads clean Tally workbook.
2. Analyst uploads workbook with unmapped parties and resolves mapping.
3. Analyst uploads workbook with missing FX and publish is blocked.
4. Admin overrides publish with documented reason.
5. Snapshot publish creates invoice snapshots and collection tasks.
6. Analyst assigns, snoozes, and completes collection task.
7. Analyst logs promise to pay; promise later becomes broken.
8. Analyst raises and resolves dispute with resolution note.
9. Admin reconciles snapshot and mismatch banner appears.
10. CFO views dashboard and downloads ageing export.
11. Admin approves digest; email is queued and processed.

### 16.3 UAT Entry Criteria

- Production OAuth working in staging.
- Staging DB seeded with approved users and entities.
- Object storage configured.
- Email sending tested to internal recipients.
- At least two real workbooks available: India Tally and UAE Xero.
- UAT issue tracker prepared.

### 16.4 UAT Exit Criteria

| Exit criterion | Target |
|---|---|
| Real snapshots uploaded | At least 2 per entity |
| Critical defects | 0 open |
| High defects | 0 launch-blocking open items |
| Reconciliation | Dashboard AR matches accounting AR within threshold or approved waiver |
| Analyst training | Primary analysts can complete upload and tasks without developer support |
| CFO signoff | CFO accepts digest and dashboard summary format |

### 16.5 Parallel Run

Run Receivables OS and the existing Excel tracker in parallel for two snapshot cycles. Compare:

- Total AR.
- Bucket totals.
- Top overdue parties.
- 90+ exposure.
- Reconciliation delta.
- Task list completeness.

Do not retire the Excel tracker until differences are explained and signed off.

---

## 17. Production Readiness Checklist

### 17.1 Infrastructure

| Item | Status target |
|---|---|
| Google OAuth configured | Required |
| Production environment variables set | Required |
| Neon production DB configured | Required |
| Prisma migrations verified | Required |
| S3/R2 bucket configured | Required |
| Resend domain verified | Required |
| SPF/DKIM records verified | Required |
| Sentry configured | Required |
| Vercel Analytics enabled | Required |
| Cron routes protected | Required |

### 17.2 Security

| Item | Status target |
|---|---|
| RBAC smoke test complete | Required |
| Entity-scope test complete | Required |
| Upload file type and size validation | Required |
| Rate limiting enabled | Required |
| Secrets reviewed | Required |
| Admin override audit tested | Required |
| Basic OWASP review complete | Required |

### 17.3 Data and Operations

| Item | Status target |
|---|---|
| Backup schedule configured | Required |
| Restore test completed | Required before broad rollout |
| Data retention policy approved | Required |
| Support runbook created | Required |
| Incident contacts defined | Required |
| Rollback plan documented | Required |
| First two UAT snapshots signed off | Required |

---

## 18. Monitoring and Runbooks

### 18.1 Alerts

| Alert | Threshold | Owner |
|---|---|---|
| API error rate | >1% for 10 minutes | Engineering |
| Dashboard p95 latency | >3 seconds for 15 minutes | Engineering |
| Upload failure rate | >10% in a day | Engineering + Finance Admin |
| Email failure rate | >5 failed sends or repeated bounce | Engineering |
| Cron failure | Missed digest/email/PTP job | Engineering |
| DB connection exhaustion | Pool available <50% | Engineering |
| Reconciliation mismatch | Delta exceeds threshold | Finance Admin |

### 18.2 Incident Severity

| Severity | Definition | Example | Response |
|---|---|---|---|
| P0 | Financial data loss or unauthorized access | Cross-entity data exposure | Stop affected workflow, revoke access, preserve logs |
| P1 | Core workflow blocked | Cannot publish snapshots | Fix or rollback same day |
| P2 | Major feature degraded | Digest emails failing | Workaround and scheduled fix |
| P3 | Minor defect | UI formatting issue | Backlog or next release |

### 18.3 Backup and Restore Runbook

1. Confirm latest automated backup timestamp.
2. Restore backup to non-production database.
3. Run migration compatibility checks.
4. Validate sample users, snapshots, invoice counts, and audit logs.
5. Record restore duration and data completeness.
6. Escalate if restore exceeds recovery target.

### 18.4 Rollback Runbook

1. Freeze new uploads and publish actions.
2. Identify last known good deployment.
3. Roll back Vercel deployment.
4. If migration changed schema, apply documented rollback or restore DB snapshot.
5. Re-run smoke tests: auth, dashboard, upload staging, task list, export.
6. Notify finance users with clear status and workaround.
7. Record incident and preventive action.

---

## 19. Release Roadmap

### Phase 1 - Production Hardening, Weeks 1-4

| Week | Focus | Deliverables |
|---|---|---|
| 1 | Security and infrastructure | OAuth, env vars, Resend DNS, S3/R2, cron secret, Sentry |
| 2 | Testing and quality | 80% target coverage for core logic, Playwright critical flows, performance checks |
| 3 | UAT and documentation | Real Tally/Xero UAT, user manual, admin runbook, training material |
| 4 | Launch prep | Bug fixes, deployment, training, IND soft launch, monitoring |

Exit criteria:

- All launch blockers closed.
- No critical defects.
- Two real snapshots successfully uploaded and reconciled.
- User manual and support runbook complete.
- Rollback tested or documented with owner approval.

### Phase 2 - Enhanced UX, Weeks 5-8

| Focus | Deliverables |
|---|---|
| Bulk operations | Bulk task assign, bulk status update, bulk party merge |
| Automation | Analyst reminders, broken promise alerts, approved customer email reminders |
| Reporting | Advanced Excel export, PDF board report, DSO trend chart |
| Mobile | CFO dashboard optimized for mobile review |

### Phase 3 - Advanced Capabilities, Weeks 9-16

| Focus | Deliverables |
|---|---|
| Predictive analytics | Late-payment risk model after sufficient historical data |
| Integrations | Tally/Xero API pulls, webhooks, Slack/Teams notifications |
| Multi-currency | Multi-base-currency reporting and FX audit trail |
| Client portal | Customer invoice view, dispute submission, self-service promises |

---

## 20. Implementation Work Breakdown

### 20.1 Build Tracks

| Track | Owner profile | Scope |
|---|---|---|
| Auth/RBAC | Full-stack engineer | OAuth, sessions, role guards, entity access |
| Data ingestion | Backend engineer | Parsers, staging, validation, workbook retention |
| Domain logic | Backend engineer | Ageing, FX, settlement, task priority, state machines |
| Dashboard/UI | Full-stack engineer | Dashboard, tasks, party detail, invoice detail, staging UI |
| Reporting/email | Full-stack engineer | Excel export, digest builder, email outbox, Resend integration |
| DevOps/QA | Senior engineer | CI/CD, Sentry, monitoring, tests, backup, rollback |
| Finance UAT | Finance Admin | Real data validation and signoff |

### 20.2 Definition of Done

A feature is done only when:

- Acceptance criteria are met.
- API and UI enforce RBAC and entity scope.
- Validation exists for all inputs.
- Mutation audit log is written where required.
- Unit tests cover happy path, edge cases, and permission failures.
- E2E path is covered when the feature is part of critical workflow.
- Error and empty states are present.
- Documentation is updated.
- Production config impact is documented.

---

## 21. RACI

| Activity | Analyst | CFO | Admin | Engineering | Ops/IT |
|---|---|---|---|---|---|
| Upload snapshot | R | I | A | C | I |
| Resolve staging warnings | R | I | A | C | I |
| Publish snapshot | R | I | A | C | I |
| Reconcile AR | C | I | R/A | C | I |
| Work collection tasks | R | I | C | I | I |
| Approve digest | I | C | R/A | C | I |
| User management | I | I | R/A | C | I |
| Production deployment | I | I | C | R | A |
| Incident response | I | I | C | R | A |
| Data retention policy | C | A | R | C | C |

Legend: R = Responsible, A = Accountable, C = Consulted, I = Informed.

---

## 22. Risks and Mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Accounting export format changes | Medium | High | Version-aware parsers, staging warnings, manual mapping fallback |
| Users stay on Excel | Medium | High | Parallel run, training, CFO mandate, prove time saved |
| Parser silently drops rows | Low | Critical | Never-drop staging design, row counts, parse-error visibility |
| Wrong ageing due to credit rules | Medium | High | Effective-dated credit config and UAT boundary cases |
| Email deliverability issues | Medium | Medium | SPF/DKIM, internal test sends, outbox monitoring |
| Performance degrades over 10K invoices | Medium | Medium | Indexes, pagination, caching, export streaming |
| Cross-entity data leak | Low | Critical | RBAC tests, route guards, security review |
| Vendor outage | Low | High | Backups, status monitoring, restore plan |
| Scope creep | High | Medium | Phase gates and change-control process |
| Predictive analytics added too early | Medium | Medium | Require clean historical data and baseline accuracy first |

---

## 23. Assumptions, Dependencies, and Open Decisions

### 23.1 Assumptions

- Initial users are internal finance team members only.
- Initial accounting systems are Tally for India and Xero for UAE.
- Initial entities are India and UAE.
- Existing Excel tracker remains available during parallel run.
- No external customer access before Phase 3.
- Finance team can provide at least two real snapshots per entity for UAT.

### 23.2 Dependencies

| Dependency | Owner | Needed by |
|---|---|---|
| Google OAuth credentials | IT/Engineering | Week 1 |
| Resend account and DNS access | IT/Engineering | Week 1 |
| S3/R2 bucket and credentials | Engineering/Ops | Week 1 |
| Real Tally and Xero exports | Finance Admin | Week 3 |
| Approved email templates | Finance/CFO/Legal | Phase 2 reminders |
| Data retention policy | CFO/Admin/Legal | Production launch |
| Production domain/DNS | IT/Ops | Week 1 |

### 23.3 Open Decisions

| Decision | Recommended default | Owner |
|---|---|---|
| Missing non-INR FX handling | Block publish unless Admin override | CFO/Admin |
| Digest approval model | Manual Admin approval for first month, then auto-send if stable | CFO/Admin |
| Customer reminder launch | Do not launch until templates and opt-out process are approved | CFO/Legal |
| Reconciliation materiality | INR 1,000 absolute or 0.5% materiality threshold | CFO/Admin |
| Audit/workbook retention | 5 years minimum unless policy requires longer | CFO/Legal |
| Bulk task operations | Add in Phase 2, not MVP blocker | Product/Admin |

---

## 24. Agentic Development Appendix

This appendix consolidates the source document's agentic-development ideas into a practical build system. It should be treated as an implementation accelerator, not as a replacement for engineering review.

### 24.1 Agentic Development Principle

Use agents for repetitive, bounded implementation tasks where success can be verified through tests, linting, type checks, and acceptance criteria. Keep humans responsible for architecture, finance logic, data controls, security approval, and production release decisions.

### 24.2 Agent Roles

| Agent | Responsibility | Human approval required? |
|---|---|---|
| ProductAgent | Converts PRD sections into scoped user stories | Yes |
| SchemaAgent | Proposes Prisma schema changes and migrations | Yes |
| APIAgent | Builds validated route handlers and RBAC checks | Yes for new routes |
| UIAgent | Builds pages/components using existing design system | Review required |
| TestAgent | Creates Vitest and Playwright tests | No, but coverage reviewed |
| DevOpsAgent | Proposes CI/CD, env, monitoring, and rollback scripts | Yes |
| DocAgent | Maintains user manual, API docs, and runbooks | Review required |

### 24.3 Agent Guardrails

- No agent may bypass RBAC or audit logging.
- No agent may create a mutation endpoint without validation and tests.
- No agent may modify financial calculation logic without explicit test cases.
- No agent may deploy production changes without human approval.
- No agent may change schema without migration notes and rollback considerations.

### 24.4 Standard Agent Task Contract

```json
{
  "task_id": "ROS-F-3.11",
  "objective": "Add bulk task assignment",
  "acceptance_criteria": [
    "Analyst can bulk assign own-entity tasks",
    "Analyst cannot assign cross-entity tasks",
    "CFO receives 403 on mutation",
    "Admin can bulk assign across entities",
    "Audit log records every changed task"
  ],
  "validation_commands": [
    "npm run lint",
    "npm run typecheck",
    "npm test",
    "npm run build"
  ],
  "required_outputs": [
    "code_changes",
    "test_files",
    "migration_notes_if_any",
    "risk_notes"
  ]
}
```

### 24.5 Agentic Workflow

```text
PRD requirement
   |
   v
ProductAgent creates story and acceptance criteria
   |
   v
Architecture/Finance human approves scope
   |
   v
SchemaAgent/APIAgent/UIAgent implement bounded changes
   |
   v
TestAgent generates and runs tests
   |
   v
Human reviews financial logic, RBAC, and data risks
   |
   v
DevOpsAgent prepares release checklist
   |
   v
Human-approved deployment
```

### 24.6 Autonomy Levels

| Level | Description | Suitable for |
|---|---|---|
| L1 | Suggest only | Business rules, architecture changes |
| L2 | Draft code with human review | New feature modules |
| L3 | Implement with spot-check | UI states, tests, documentation |
| L4 | Auto-merge after validation | Low-risk docs and test improvements only |

---

## 25. Final Launch Gate

Receivables OS is ready for initial production only when all of the following are true:

1. Production OAuth is live and PENDING users cannot access data.
2. Analyst entity-scope tests pass.
3. Admin override works and writes audit log.
4. Real Tally and Xero snapshots have passed UAT.
5. Dashboard totals reconcile to accounting AR within approved threshold.
6. Uploaded workbooks are retained with hash and snapshot linkage.
7. CFO digest can be approved, queued, sent, and monitored.
8. Backup and restore process is documented and tested at least once.
9. Sentry/monitoring alerts are configured.
10. User manual and runbook are complete.
11. Rollback process is documented.
12. Excel parallel run has no unexplained material variance.

---

## 26. Immediate Next Actions

| Priority | Action | Owner | Target |
|---|---|---|---|
| 1 | Configure production OAuth and env vars | Engineering | Week 1 |
| 2 | Configure Resend DNS and test internal digest | Engineering/IT | Week 1 |
| 3 | Configure object storage and workbook hash retention | Engineering | Week 1 |
| 4 | Add parser/ageing/RBAC/state-machine test coverage | Engineering | Week 2 |
| 5 | Freeze Twenty/Duolingo-inspired UI tokens, engagement guardrails, and Storybook stories for core workflows | Product/Design/Engineering | Week 2 |
| 6 | Define Focus Queue metrics, streak/freeze rules, and notification copy before UAT | Product/Finance Admin | Week 2 |
| 7 | Prepare UAT workbooks and expected Excel comparison | Finance Admin | Week 2 |
| 8 | Run India UAT and reconcile | Finance + Engineering | Week 3 |
| 9 | Write analyst/admin/CFO user guide | Product/Admin | Week 3 |
| 10 | Soft launch India with monitoring | Engineering + Finance | Week 4 |
| 11 | Launch UAE after one stable India cycle | Engineering + Finance | Week 5 |

---

## Appendix A - Cleanup Notes From Source PDF

The uploaded source PDF contained useful product and technical thinking, but it was not production-ready as a document. The final version above makes the following corrections:

- Consolidates repeated PRD sections into one structure.
- Completes the out-of-scope section that was cut off at “Multi-company consolid”.
- Separates current assessment from future roadmap.
- Moves agentic development content into an appendix.
- Removes chat logs, assistant reasoning text, error messages, raw snippets, and duplicated markdown blocks.
- Tightens vague acceptance criteria into testable requirements.
- Resolves ambiguous rules around FX, settlement, ageing date, reconciliation thresholds, and admin override.
- Adds missing operational sections: backup, rollback, monitoring, incident severity, UAT, RACI, dependencies, and launch gate.


---

## Appendix B - External Design References

The design language section is based on public Twenty CRM, Duolingo, and UX guideline references translated into Receivables OS requirements. It does not require copying Twenty branding, Duolingo branding, mascot assets, logo assets, or proprietary marketing visuals.

| Reference | Design relevance | URL |
|---|---|---|
| Twenty GitHub repository | Confirms Twenty is an open-source CRM, designed for AI, and exposes app-building concepts around objects, views, agents, and logic functions. | https://github.com/twentyhq/twenty |
| Twenty Layout documentation | Confirms the workspace model: left navigation, command menu, global search, side panel, saved views, table/kanban/calendar views, and record pages. | https://docs.twenty.com/getting-started/core-concepts/layout |
| Twenty Data Model documentation | Confirms the object/field/relation model and the ability to create custom objects. | https://docs.twenty.com/getting-started/core-concepts/data-model |
| Twenty Dashboards documentation | Confirms dashboards use widgets, chart types, filters, aggregations, grouping, sharing, and grid arrangement. | https://docs.twenty.com/getting-started/core-concepts/dashboards |
| Twenty Workflows documentation | Confirms workflow triggers, actions, variables, branches, delays, forms, and schedule/webhook patterns. | https://docs.twenty.com/getting-started/core-concepts/workflows |
| Duolingo streak research blog | Supports the habit-loop inspiration: measurable streaks, consistency, streak flexibility, and feedback animations. | https://blog.duolingo.com/how-duolingo-streak-builds-habit/ |
| Nielsen Norman Group keyboard accessibility | Supports keyboard-accessible navigation and visible focus states. | https://www.nngroup.com/articles/keyboard-accessibility/ |
| Nielsen Norman Group command naming and shortcuts | Supports brief, informative command names and conventional shortcuts. | https://www.nngroup.com/articles/ui-copy/ |
| Nielsen Norman Group UI accelerators | Supports surfacing keyboard accelerators in menus/tooltips and documenting shortcuts for expert users. | https://www.nngroup.com/articles/ui-accelerators/ |

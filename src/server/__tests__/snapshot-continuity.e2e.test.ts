/**
 * End-to-end synthetic-data verification for PR 1 — snapshot continuity:
 *   • Gap 4: same-day cadence guard rejects a duplicate publish.
 *   • Gap 1: change_status="new" returns only invoices first seen in the
 *           latest published snapshot per entity.
 *
 * This test hits the live database configured via .env.local. It is gated
 * behind SYNTHETIC_E2E=1 so it never runs in regular CI / `npm test`.
 *
 * Run with:
 *   SYNTHETIC_E2E=1 npx vitest run src/server/__tests__/snapshot-continuity.e2e.test.ts
 */
import { config as loadEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Load .env.local before importing anything that touches the env (Prisma).
const envLocal = resolve(process.cwd(), ".env.local");
if (existsSync(envLocal)) loadEnv({ path: envLocal });

const ENABLED = process.env.SYNTHETIC_E2E === "1";

// Looked up from the live DB once via __lookup-ids.test.ts.
const ind = "600e57f5-8718-4517-9c99-cf56d4bd7a51";
const adminUserId = "3805b9d4-906a-4da9-a0b8-aca542e62ba4";
const tag = "E2E_PR1";

describe.skipIf(!ENABLED)("snapshot continuity (PR 1+2+3) — synthetic E2E", () => {
  let getPrisma: typeof import("@/lib/prisma").getPrisma;
  let publishSnapshot: typeof import("@/server/snapshots/service").publishSnapshot;
  let listInvoices: typeof import("@/server/invoices/service").listInvoices;
  let HttpError: typeof import("@/server/core/errors").HttpError;
  let role_enum: typeof import("@/generated/prisma/enums").role_enum;
  let autoResolveCascadeOnSettle: typeof import("@/server/snapshots/auto-resolve").autoResolveCascadeOnSettle;

  // Synthetic IDs — all start with "ee" so the cleanup query is unambiguous.
  const partyId = "ee000000-0000-0000-0000-000000000001";
  const snap1Id = "ee000000-0000-0000-0000-0000000000a1"; // PUBLISHED 2026-05-10
  const snap2Id = "ee000000-0000-0000-0000-0000000000a2"; // STAGED   2026-05-10 (collides)
  const snap3Id = "ee000000-0000-0000-0000-0000000000a3"; // PUBLISHED 2026-05-17 (delta)
  const inv1Id = "ee000000-0000-0000-0000-0000000000b1"; // first seen in snap1
  const inv2Id = "ee000000-0000-0000-0000-0000000000b2"; // first seen in snap1
  const inv3Id = "ee000000-0000-0000-0000-0000000000b3"; // first seen in snap1
  const invNewId = "ee000000-0000-0000-0000-0000000000b4"; // first seen in snap3 ← THE NEW ONE
  // Operational objects attached to inv1 — used to verify Option A cascade.
  const ptpId = "ee000000-0000-0000-0000-0000000000c1";
  const disputeId = "ee000000-0000-0000-0000-0000000000c2";
  const taskId = "ee000000-0000-0000-0000-0000000000c3";
  const exceptionId = "ee000000-0000-0000-0000-0000000000c4";

  beforeAll(async () => {
    ({ getPrisma } = await import("@/lib/prisma"));
    ({ publishSnapshot } = await import("@/server/snapshots/service"));
    ({ listInvoices } = await import("@/server/invoices/service"));
    ({ HttpError } = await import("@/server/core/errors"));
    ({ role_enum } = await import("@/generated/prisma/enums"));
    ({ autoResolveCascadeOnSettle } = await import(
      "@/server/snapshots/auto-resolve"
    ));

    const prisma = getPrisma();
    // Idempotent cleanup of any prior run.
    await cleanup(prisma);

    const sha = (suffix: string) => suffix.padStart(64, "0");

    // Synthetic party.
    await prisma.parties_canonical.create({
      data: {
        id: partyId,
        entity_id: ind,
        name: `${tag} Acme Pvt Ltd`,
        created_by: adminUserId,
      },
    });

    // Snapshot 1 — PUBLISHED on 2026-05-10. Sets up the same-day collision.
    await prisma.snapshots.create({
      data: {
        id: snap1Id,
        entity_id: ind,
        uploaded_by: adminUserId,
        upload_file_sha256: sha(`${tag}A1`),
        as_of_date: new Date("2026-05-10"),
        source_hint: "TALLY",
        status: "PUBLISHED",
        published_by: adminUserId,
        published_at: new Date("2026-05-10T10:00:00Z"),
        published_as: "NORMAL",
      },
    });

    // 3 invoices first seen in snapshot 1.
    for (const id of [inv1Id, inv2Id, inv3Id]) {
      await prisma.invoices.create({
        data: {
          id,
          entity_id: ind,
          canonical_id: partyId,
          invoice_ref: `${tag}-${id.slice(-4)}`,
          invoice_date: new Date("2026-04-15"),
          amount: "10000.00",
          currency: "INR",
          credit_days_applied: 30,
          credit_days_source: "DEFAULT",
          due_date: new Date("2026-05-15"),
          status: "OPEN",
          first_seen_snapshot_id: snap1Id,
          raw_row_json: {},
        },
      });
    }

    // Snapshot 2 — STAGED on the same date, will trigger the cadence guard.
    await prisma.snapshots.create({
      data: {
        id: snap2Id,
        entity_id: ind,
        uploaded_by: adminUserId,
        upload_file_sha256: sha(`${tag}A2`),
        as_of_date: new Date("2026-05-10"),
        source_hint: "TALLY",
        status: "STAGED",
      },
    });

    // Snapshot 3 — PUBLISHED on a later date, with one new invoice.
    await prisma.snapshots.create({
      data: {
        id: snap3Id,
        entity_id: ind,
        uploaded_by: adminUserId,
        upload_file_sha256: sha(`${tag}A3`),
        as_of_date: new Date("2026-05-17"),
        source_hint: "TALLY",
        status: "PUBLISHED",
        published_by: adminUserId,
        published_at: new Date("2026-05-17T10:00:00Z"),
        published_as: "NORMAL",
      },
    });

    // The NEW invoice — first seen in snapshot 3.
    await prisma.invoices.create({
      data: {
        id: invNewId,
        entity_id: ind,
        canonical_id: partyId,
        invoice_ref: `${tag}-NEW0`,
        invoice_date: new Date("2026-05-12"),
        amount: "25000.00",
        currency: "INR",
        credit_days_applied: 30,
        credit_days_source: "DEFAULT",
        due_date: new Date("2026-06-11"),
        status: "OPEN",
        first_seen_snapshot_id: snap3Id,
        raw_row_json: {},
      },
    });
  }, 60_000);

  afterAll(async () => {
    if (!ENABLED) return;
    const prisma = getPrisma();
    await cleanup(prisma);
  }, 60_000);

  it("Gap 4: rejects a same-day duplicate publish with snapshot_same_day_exists", async () => {
    const adminUser = {
      id: adminUserId,
      email: "tejaswa.sharma@emb.global",
      name: "Tejaswa Sharma",
      role: role_enum.ADMIN,
      entityIdScope: null,
      isActive: true,
      lastLoginAt: null,
    };

    let caught: unknown = null;
    try {
      await publishSnapshot(snap2Id, adminUser);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(HttpError);
    const httpErr = caught as InstanceType<typeof HttpError>;
    expect(httpErr.code).toBe("snapshot_same_day_exists");
    expect(httpErr.status).toBe(409);
    expect(httpErr.message).toContain(snap1Id);
  });

  it("Gap 2: autoResolveCascadeOnSettle closes attached PTP/dispute/task/exception_tag", async () => {
    const prisma = getPrisma();

    // Pick any active exception bucket type from the live DB.
    const bucketType = await prisma.exception_bucket_types.findFirst({
      where: { active: true },
      select: { id: true },
    });
    if (!bucketType) {
      throw new Error(
        "No active exception_bucket_types in DB — seed them first.",
      );
    }

    // Seed: 1 OPEN PTP, 1 OPEN dispute, 1 OPEN task, 1 ACTIVE exception_tag
    // — all attached to inv1.
    await prisma.promises_to_pay.create({
      data: {
        id: ptpId,
        canonical_id: partyId,
        invoice_id: inv1Id,
        amount: "5000.00",
        currency: "INR",
        promised_date: new Date("2026-05-20"),
        status: "OPEN",
        notes: "user-authored note must survive",
        created_by: adminUserId,
      },
    });
    await prisma.dispute_cases.create({
      data: {
        id: disputeId,
        entity_id: ind,
        canonical_id: partyId,
        invoice_id: inv1Id,
        reason_code: "PRICE_MISMATCH",
        description: "Customer disputed pricing",
        status: "OPEN",
        created_by: adminUserId,
      },
    });
    await prisma.collection_tasks.create({
      data: {
        id: taskId,
        entity_id: ind,
        canonical_id: partyId,
        invoice_id: inv1Id,
        source_type: "SUGGESTED",
        reason_code: "NINETY_PLUS",
        priority_score: "75.0",
        status: "OPEN",
        created_by: adminUserId,
      },
    });
    await prisma.exception_tags.create({
      data: {
        id: exceptionId,
        invoice_id: inv1Id,
        bucket_type_id: bucketType.id,
        reason: "Synthetic test",
        tagged_by: adminUserId,
        status: "ACTIVE",
      },
    });

    // Run cascade in a transaction (mirrors how publishSnapshot calls it).
    const counts = await prisma.$transaction(async (tx) =>
      autoResolveCascadeOnSettle(tx, {
        snapshotId: snap1Id,
        settledInvoiceIds: [inv1Id],
        now: new Date(),
      }),
    );

    expect(counts).toEqual({
      promises_to_pay: 1,
      dispute_cases: 1,
      collection_tasks: 1,
      exception_tags: 1,
    });

    const ptp = await prisma.promises_to_pay.findUnique({
      where: { id: ptpId },
    });
    expect(ptp?.status).toBe("CANCELLED");
    expect(ptp?.notes).toBe("user-authored note must survive"); // not overwritten

    const dispute = await prisma.dispute_cases.findUnique({
      where: { id: disputeId },
    });
    expect(dispute?.status).toBe("CLOSED");
    expect(dispute?.resolved_at).not.toBeNull();
    expect(dispute?.resolution_note).toContain(snap1Id);

    const task = await prisma.collection_tasks.findUnique({
      where: { id: taskId },
    });
    expect(task?.status).toBe("DISMISSED");
    expect(task?.completed_at).not.toBeNull();
    expect(task?.dismissed_reason).toContain(snap1Id);

    const tag = await prisma.exception_tags.findUnique({
      where: { id: exceptionId },
    });
    expect(tag?.status).toBe("AUTO_RESOLVED");
    expect(tag?.resolved_at).not.toBeNull();
    expect(tag?.resolution_note).toContain(snap1Id);
  });

  it("Gap 2: change_status='closed' returns invoices settled by the latest snapshot, with is_closed_in_latest_snapshot", async () => {
    // Manually settle inv2 against snap3 (the latest published snapshot
    // for IND in this test). Mirrors what the publishSnapshot bulk-settle
    // sweep would do.
    const prisma = getPrisma();
    await prisma.invoices.update({
      where: { id: inv2Id },
      data: { status: "SETTLED", settled_snapshot_id: snap3Id },
    });

    const adminUser = {
      id: adminUserId,
      email: "tejaswa.sharma@emb.global",
      name: "Tejaswa Sharma",
      role: role_enum.ADMIN,
      entityIdScope: null,
      isActive: true,
      lastLoginAt: null,
    };

    const closed = await listInvoices(
      {
        entity: "IND",
        party_canonical_id: partyId,
        change_status: "closed",
        page: 1,
        page_size: 50,
      },
      adminUser,
    );
    const ours = closed.items.filter((i) => i.invoice_ref.startsWith(tag));
    expect(ours.length).toBe(1);
    expect(ours[0].invoice_id).toBe(inv2Id);
    expect(ours[0].is_closed_in_latest_snapshot).toBe(true);
    expect(ours[0].status).toBe("SETTLED");
  });

  it("Gap 3: diffInvoice captures field deltas and listInvoices surfaces 'changed' + acknowledge clears it", async () => {
    const prisma = getPrisma();
    const { diffInvoice } = await import("@/server/snapshots/invoice-diff");
    const { acknowledgeInvoiceChanges } = await import(
      "@/server/invoice-changes/service"
    );

    // Pure helper sanity check.
    const deltas = diffInvoice(
      {
        amount: "10000.00",
        due_date: new Date("2026-05-15"),
        credit_days_applied: 30,
        invoice_date: new Date("2026-04-15"),
        currency: "INR",
      },
      {
        amount: "9500.00",
        due_date: new Date("2026-05-20"),
        credit_days_applied: 35,
        invoice_date: new Date("2026-04-15"),
        currency: "INR",
      },
    );
    expect(deltas).toHaveLength(3);
    expect(deltas.map((d) => d.field).sort()).toEqual([
      "amount",
      "credit_days",
      "due_date",
    ]);

    // Simulate what publishSnapshot does: write two invoice_changes rows
    // tied to the latest snapshot (snap3) for inv3 — amount and due_date.
    const change1Id = "ee000000-0000-0000-0000-0000000000d1";
    const change2Id = "ee000000-0000-0000-0000-0000000000d2";
    await prisma.invoice_changes.createMany({
      data: [
        {
          id: change1Id,
          invoice_id: inv3Id,
          snapshot_id: snap3Id,
          field: "amount",
          before_value: "10000.00",
          after_value: "9500.00",
        },
        {
          id: change2Id,
          invoice_id: inv3Id,
          snapshot_id: snap3Id,
          field: "due_date",
          before_value: "2026-05-15",
          after_value: "2026-05-20",
        },
      ],
    });

    const adminUser = {
      id: adminUserId,
      email: "tejaswa.sharma@emb.global",
      name: "Tejaswa Sharma",
      role: role_enum.ADMIN,
      entityIdScope: null,
      isActive: true,
      lastLoginAt: null,
    };

    // listInvoices with change_status='changed' must return inv3.
    const changed = await listInvoices(
      {
        entity: "IND",
        party_canonical_id: partyId,
        change_status: "changed",
        page: 1,
        page_size: 50,
      },
      adminUser,
    );
    const ours = changed.items.filter((i) => i.invoice_ref.startsWith(tag));
    expect(ours.length).toBe(1);
    expect(ours[0].invoice_id).toBe(inv3Id);
    expect(ours[0].unack_change_count_in_latest_snapshot).toBe(2);

    // Acknowledge one of them — count drops to 1, invoice still listed.
    const ack1 = await acknowledgeInvoiceChanges(
      { change_ids: [change1Id] },
      adminUser,
    );
    expect(ack1).toEqual({
      acknowledged: 1,
      already_acknowledged: 0,
      skipped_inaccessible: 0,
    });
    const partial = await listInvoices(
      {
        entity: "IND",
        party_canonical_id: partyId,
        change_status: "changed",
        page: 1,
        page_size: 50,
      },
      adminUser,
    );
    const oursPartial = partial.items.filter((i) =>
      i.invoice_ref.startsWith(tag),
    );
    expect(oursPartial.length).toBe(1);
    expect(oursPartial[0].unack_change_count_in_latest_snapshot).toBe(1);

    // Acknowledge the second — invoice drops out of the Changed view.
    const ack2 = await acknowledgeInvoiceChanges(
      { change_ids: [change2Id] },
      adminUser,
    );
    expect(ack2.acknowledged).toBe(1);
    const empty = await listInvoices(
      {
        entity: "IND",
        party_canonical_id: partyId,
        change_status: "changed",
        page: 1,
        page_size: 50,
      },
      adminUser,
    );
    expect(empty.items.filter((i) => i.invoice_ref.startsWith(tag))).toEqual(
      [],
    );

    // Re-acknowledging is idempotent.
    const ack3 = await acknowledgeInvoiceChanges(
      { change_ids: [change1Id, change2Id] },
      adminUser,
    );
    expect(ack3).toEqual({
      acknowledged: 0,
      already_acknowledged: 2,
      skipped_inaccessible: 0,
    });
  }, 30_000);

  it("Gap 1: change_status='new' returns only invoices first seen in the latest snapshot", async () => {
    const adminUser = {
      id: adminUserId,
      email: "tejaswa.sharma@emb.global",
      name: "Tejaswa Sharma",
      role: role_enum.ADMIN,
      entityIdScope: null,
      isActive: true,
      lastLoginAt: null,
    };

    const all = await listInvoices(
      {
        entity: "IND",
        party_canonical_id: partyId,
        page: 1,
        page_size: 50,
      },
      adminUser,
    );
    const ours = all.items.filter((i) => i.invoice_ref.startsWith(tag));
    expect(ours.length).toBe(4); // 3 old + 1 new

    const newOnly = await listInvoices(
      {
        entity: "IND",
        party_canonical_id: partyId,
        change_status: "new",
        page: 1,
        page_size: 50,
      },
      adminUser,
    );
    const oursNew = newOnly.items.filter((i) => i.invoice_ref.startsWith(tag));
    expect(oursNew.length).toBe(1);
    expect(oursNew[0].invoice_ref).toBe(`${tag}-NEW0`);
    expect(oursNew[0].is_new_in_latest_snapshot).toBe(true);

    // The 3 older invoices should NOT be marked is_new in the unfiltered list.
    const oldOnes = ours.filter((i) => i.invoice_ref !== `${tag}-NEW0`);
    for (const inv of oldOnes) {
      expect(inv.is_new_in_latest_snapshot).toBe(false);
    }
  });
});

// ─── Real-publish E2E (Gap 3 end-to-end) ───────────────────────────────────
// Goes through the actual publishSnapshot() flow — STAGED snapshot row with
// parse_result_json + analyst_overrides → publish → diff capture → list →
// acknowledge. Uses the UAE entity and a dedicated UUID prefix (`ef…`) to
// stay isolated from the IND fixtures used by the unit-style suite above.

const UAE = "470295c1-8709-435d-a695-101d9d986db2";

describe.skipIf(!ENABLED)(
  "snapshot continuity — real publish flow (PR 3)",
  () => {
    let getPrisma: typeof import("@/lib/prisma").getPrisma;
    let publishSnapshot: typeof import("@/server/snapshots/service").publishSnapshot;
    let listInvoices: typeof import("@/server/invoices/service").listInvoices;
    let acknowledgeInvoiceChanges: typeof import("@/server/invoice-changes/service").acknowledgeInvoiceChanges;
    let role_enum: typeof import("@/generated/prisma/enums").role_enum;

    const partyId = "ef000000-0000-0000-0000-000000000001";
    const snapAId = "ef000000-0000-0000-0000-0000000000a1"; // 1st publish
    const snapBId = "ef000000-0000-0000-0000-0000000000a2"; // 2nd publish (drift)

    const adminUser = () => ({
      id: adminUserId,
      email: "tejaswa.sharma@emb.global",
      name: "Tejaswa Sharma",
      role: role_enum.ADMIN,
      entityIdScope: null,
      isActive: true,
      lastLoginAt: null,
    });

    /**
     * Build a parse_result_json payload + matching staging_overrides_json
     * that pre-resolves every row to `partyId` (so the publish gate passes
     * without going through the alias resolver).
     */
    function buildSnapshotJson(
      rows: Array<{
        invoice_ref: string;
        invoice_date: string; // YYYY-MM-DD
        amount: string;
      }>,
      asOfDate: string,
      sha: string,
    ) {
      const parse_result_json = {
        invoices: rows.map((r, i) => ({
          row_index: i,
          status: "OK" as const,
          source_currency: "AED" as const,
          party_name_raw: "Synthetic UAE Party Ltd",
          gstin: null,
          xero_contact_id: null,
          invoice_ref: r.invoice_ref,
          invoice_date: r.invoice_date,
          amount: r.amount,
          raw_row_json: { synthetic: "1" },
          xero_metadata: null,
          parse_error_reason: null,
        })),
        credit_periods: [],
        errors: [],
        warnings: [],
        as_of_date: asOfDate,
        file_sha256: sha,
        source_hint: "TALLY" as const,
        is_valid: true,
      };
      // Pre-resolve every row (alias) AND pin credit_days=30 via override
      // — UAE has NULL default_credit_days in the seed, and we don't want
      // to mutate the entity globally just for this test.
      const staging_overrides_json = rows.flatMap((_r, i) => [
        {
          row_index: i,
          action: "resolve_alias",
          resolved_canonical_id: partyId,
          created_at: new Date().toISOString(),
          actor_id: adminUserId,
        },
        {
          row_index: i,
          action: "override_credit_days",
          credit_days_override: 30,
          credit_days_source: "MANUAL",
          created_at: new Date().toISOString(),
          actor_id: adminUserId,
        },
      ]);
      return { parse_result_json, staging_overrides_json };
    }

    beforeAll(async () => {
      ({ getPrisma } = await import("@/lib/prisma"));
      ({ publishSnapshot } = await import("@/server/snapshots/service"));
      ({ listInvoices } = await import("@/server/invoices/service"));
      ({ acknowledgeInvoiceChanges } = await import(
        "@/server/invoice-changes/service"
      ));
      ({ role_enum } = await import("@/generated/prisma/enums"));

      const prisma = getPrisma();
      await cleanupPublishE2E(prisma);

      // Synthetic UAE party.
      await prisma.parties_canonical.create({
        data: {
          id: partyId,
          entity_id: UAE,
          name: "EF E2E UAE Party Ltd",
          created_by: adminUserId,
        },
      });
    }, 60_000);

    afterAll(async () => {
      if (!ENABLED) return;
      const prisma = getPrisma();
      await cleanupPublishE2E(prisma);
    }, 60_000);

    it("publishes snapshot A on 2026-03-01, then snapshot B on 2026-03-08 with drift, captures 3 deltas across 2 invoices, and acknowledge clears the Changed view", async () => {
      const prisma = getPrisma();
      const sha = (suffix: string) => suffix.padStart(64, "0");

      // ── Publish A — 3 fresh invoices, no diff expected (all NEW). ──
      const rowsA = [
        {
          invoice_ref: "PUBE2E-1",
          invoice_date: "2026-02-01",
          amount: "10000.00",
        },
        {
          invoice_ref: "PUBE2E-2",
          invoice_date: "2026-02-05",
          amount: "20000.00",
        },
        {
          invoice_ref: "PUBE2E-3",
          invoice_date: "2026-02-10",
          amount: "30000.00",
        },
      ];
      const a = buildSnapshotJson(rowsA, "2026-03-01", sha("EFA"));
      await prisma.snapshots.create({
        data: {
          id: snapAId,
          entity_id: UAE,
          uploaded_by: adminUserId,
          upload_file_sha256: sha("EFA"),
          as_of_date: new Date("2026-03-01"),
          source_hint: "TALLY",
          status: "STAGED",
          parse_result_json:
            a.parse_result_json as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
          staging_overrides_json:
            a.staging_overrides_json as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      const respA = await publishSnapshot(snapAId, adminUser());
      expect(respA.status).toBe("PUBLISHED");
      expect(respA.invoices_upserted).toBe(3);
      expect(respA.changes_detected).toEqual({ total: 0, by_field: {} });

      // ── Publish B — same 3 refs, but row 0's amount drifts and
      // row 1's invoice_date drifts (which cascades into due_date). ──
      const rowsB = [
        {
          invoice_ref: "PUBE2E-1",
          invoice_date: "2026-02-01",
          amount: "9500.00",
        }, // amount changed
        {
          invoice_ref: "PUBE2E-2",
          invoice_date: "2026-02-08",
          amount: "20000.00",
        }, // invoice_date changed → due_date too
        {
          invoice_ref: "PUBE2E-3",
          invoice_date: "2026-02-10",
          amount: "30000.00",
        }, // unchanged
      ];
      const b = buildSnapshotJson(rowsB, "2026-03-08", sha("EFB"));
      await prisma.snapshots.create({
        data: {
          id: snapBId,
          entity_id: UAE,
          uploaded_by: adminUserId,
          upload_file_sha256: sha("EFB"),
          as_of_date: new Date("2026-03-08"),
          source_hint: "TALLY",
          status: "STAGED",
          parse_result_json:
            b.parse_result_json as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
          staging_overrides_json:
            b.staging_overrides_json as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      const respB = await publishSnapshot(snapBId, adminUser());
      expect(respB.status).toBe("PUBLISHED");
      expect(respB.invoices_upserted).toBe(3);
      // Row 0 → 1 delta (amount). Row 1 → 2 deltas (invoice_date + due_date).
      // Row 2 → no diff. Total = 3 across 2 invoices.
      expect(respB.changes_detected?.total).toBe(3);
      expect(respB.changes_detected?.by_field).toMatchObject({
        amount: 1,
        invoice_date: 1,
        due_date: 1,
      });

      // ── Visit /invoices?change_status=changed (UAE scope). ──
      const changed = await listInvoices(
        {
          entity: "UAE",
          party_canonical_id: partyId,
          change_status: "changed",
          page: 1,
          page_size: 50,
        },
        adminUser(),
      );
      const refs = changed.items
        .map((i) => i.invoice_ref)
        .filter((r) => r.startsWith("PUBE2E-"))
        .sort();
      expect(refs).toEqual(["PUBE2E-1", "PUBE2E-2"]);

      const row1 = changed.items.find((i) => i.invoice_ref === "PUBE2E-1")!;
      const row2 = changed.items.find((i) => i.invoice_ref === "PUBE2E-2")!;
      expect(row1.unack_change_count_in_latest_snapshot).toBe(1);
      expect(row2.unack_change_count_in_latest_snapshot).toBe(2);

      // ── POST /api/invoice-changes/acknowledge with both change_ids. ──
      const allChanges = await prisma.invoice_changes.findMany({
        where: { snapshot_id: snapBId },
        select: { id: true },
      });
      const changeIds = allChanges.map((c) => c.id);
      expect(changeIds.length).toBe(3);

      const ack = await acknowledgeInvoiceChanges(
        { change_ids: changeIds },
        adminUser(),
      );
      expect(ack).toEqual({
        acknowledged: 3,
        already_acknowledged: 0,
        skipped_inaccessible: 0,
      });

      // ── PR 7: REVIEWER role — approve a fresh STAGED snapshot. ──
      // We've already published snap_pubA/B, so seed a third STAGED snapshot
      // and approve it as a synthetic REVIEWER. Self-review is rejected.
      const { reviewSnapshot } = await import("@/server/snapshots/review");
      const reviewerId = "ef000000-0000-0000-0000-0000000000e1";
      const snapReviewId = "ef000000-0000-0000-0000-0000000000a3";
      // Create a synthetic REVIEWER user.
      await prisma.users.upsert({
        where: { id: reviewerId },
        create: {
          id: reviewerId,
          email: "synthetic-reviewer@example.invalid",
          name: "Synthetic Reviewer",
          role: "REVIEWER",
          is_active: true,
        },
        update: { role: "REVIEWER", is_active: true },
      });
      const reviewerUser = {
        id: reviewerId,
        email: "synthetic-reviewer@example.invalid",
        name: "Synthetic Reviewer",
        role: role_enum.REVIEWER,
        entityIdScope: null,
        isActive: true,
        lastLoginAt: null,
      };
      // Make a STAGED snapshot uploaded by ADMIN (so reviewer is not the uploader).
      const c = buildSnapshotJson(rowsB, "2026-03-15", sha("EFC"));
      await prisma.snapshots.create({
        data: {
          id: snapReviewId,
          entity_id: UAE,
          uploaded_by: adminUserId,
          upload_file_sha256: sha("EFC"),
          as_of_date: new Date("2026-03-15"),
          source_hint: "TALLY",
          status: "STAGED",
          parse_result_json:
            c.parse_result_json as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
          staging_overrides_json:
            c.staging_overrides_json as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      // Reviewer approves with a note.
      const reviewResp = await reviewSnapshot(
        snapReviewId,
        { decision: "APPROVED", note: "Spot-checked top 5 invoices." },
        reviewerUser,
      );
      expect(reviewResp.decision).toBe("APPROVED");
      expect(reviewResp.reviewed_by).toBe(reviewerId);

      // Verify the snapshot row reflects the review and the audit log entry exists.
      const reviewed = await prisma.snapshots.findUnique({
        where: { id: snapReviewId },
        select: {
          reviewed_at: true,
          reviewed_by: true,
          review_decision: true,
          review_note: true,
        },
      });
      expect(reviewed?.review_decision).toBe("APPROVED");
      expect(reviewed?.review_note).toContain("Spot-checked");
      expect(reviewed?.reviewed_by).toBe(reviewerId);

      // Self-review attempt by the uploader is rejected.
      let selfReviewError: unknown = null;
      try {
        // adminUser uploaded the snapshot — self-review forbidden.
        await reviewSnapshot(
          snapReviewId,
          { decision: "REJECTED" },
          adminUser(),
        );
      } catch (err) {
        selfReviewError = err;
      }
      // Already reviewed once by reviewerUser — but if we reset the columns
      // we'd hit self_review_forbidden. Either way, this second review must
      // not silently succeed because the uploader is the actor.
      // (Admin-as-uploader path: reviewSnapshot allows ADMIN role; the
      //  separation-of-duties check is on uploaded_by. So the error above
      //  is "self_review_forbidden".)
      expect(selfReviewError).toBeInstanceOf(Error);
      // HttpError sets `name` to the error code.
      expect((selfReviewError as Error).name).toBe("self_review_forbidden");

      // ── Invoices fall out of the Changed view. ──
      const after = await listInvoices(
        {
          entity: "UAE",
          party_canonical_id: partyId,
          change_status: "changed",
          page: 1,
          page_size: 50,
        },
        adminUser(),
      );
      expect(
        after.items.filter((i) => i.invoice_ref.startsWith("PUBE2E-")),
      ).toEqual([]);
    }, 60_000);
  },
);

async function cleanupPublishE2E(
  prisma: import("@/generated/prisma/client").PrismaClient,
) {
  const prefix = "ef000000-0000-0000-0000-%";
  await prisma.$executeRawUnsafe(
    `DELETE FROM invoice_changes WHERE invoice_id IN (SELECT id FROM invoices WHERE canonical_id::text LIKE $1)`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM invoice_snapshots WHERE invoice_id IN (SELECT id FROM invoices WHERE canonical_id::text LIKE $1)`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM exception_tags WHERE invoice_id IN (SELECT id FROM invoices WHERE canonical_id::text LIKE $1)`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM promises_to_pay WHERE canonical_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM dispute_cases WHERE canonical_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM collection_tasks WHERE canonical_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM invoices WHERE canonical_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM snapshots WHERE id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM parties_canonical WHERE id::text LIKE $1`,
    prefix,
  );
  // PR 7 — synthetic reviewer user (audit_log rows first to avoid FK issue).
  await prisma.$executeRawUnsafe(
    `DELETE FROM audit_log WHERE actor_user_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM users WHERE id::text LIKE $1`,
    prefix,
  );
}

// All synthetic UUIDs share the "ee000000-0000-0000-0000-" prefix so we can
// scope cleanup tightly. UUID columns don't support `startsWith` in Prisma,
// so we use raw SQL.
async function cleanup(
  prisma: import("@/generated/prisma/client").PrismaClient,
) {
  const prefix = "ee000000-0000-0000-0000-%";
  // Order matters — child tables before parents.
  await prisma.$executeRawUnsafe(
    `DELETE FROM invoice_changes WHERE id::text LIKE $1 OR invoice_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM invoice_snapshots WHERE invoice_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM exception_tags WHERE id::text LIKE $1 OR invoice_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM promises_to_pay WHERE id::text LIKE $1 OR invoice_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM dispute_cases WHERE id::text LIKE $1 OR invoice_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM collection_tasks WHERE id::text LIKE $1 OR invoice_id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM invoices WHERE id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM snapshots WHERE id::text LIKE $1`,
    prefix,
  );
  await prisma.$executeRawUnsafe(
    `DELETE FROM parties_canonical WHERE id::text LIKE $1`,
    prefix,
  );
}

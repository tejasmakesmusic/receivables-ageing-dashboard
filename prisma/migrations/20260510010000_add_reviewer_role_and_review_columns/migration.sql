-- PR 7 / Gap: REVIEWER role.
-- Adds a fourth role and the per-snapshot review fields. Does NOT (yet) add
-- a hard publish gate — that's PR 7b behind a per-entity flag.

ALTER TYPE "role_enum" ADD VALUE IF NOT EXISTS 'REVIEWER';

ALTER TABLE "snapshots"
    ADD COLUMN "reviewed_at" TIMESTAMPTZ(6),
    ADD COLUMN "reviewed_by" UUID,
    ADD COLUMN "review_decision" VARCHAR(16),
    ADD COLUMN "review_note"     TEXT;

ALTER TABLE "snapshots"
    ADD CONSTRAINT "fk_snapshots_reviewed_by_users"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
    ON UPDATE NO ACTION;

ALTER TABLE "snapshots"
    ADD CONSTRAINT "ck_snapshots_review_decision"
    CHECK ("review_decision" IS NULL
           OR "review_decision" IN ('APPROVED', 'REJECTED'));

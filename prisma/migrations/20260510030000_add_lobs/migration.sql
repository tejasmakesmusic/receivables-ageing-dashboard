-- PR 9 — LOBs (Lines of Business). Per-entity tags applied to invoices so
-- analysts can slice receivables by business line, project, or vertical.
--
-- Auto-tag heuristic: Xero exports include a `PROJECT ID` column captured
-- in `xero_metadata.project_id`. At publish time we match that string
-- against `lobs.code` (case-insensitive) and stamp the invoice with the
-- matching `lob_id`. Manual override is via a dedicated PATCH endpoint
-- (deferred — keeps PR 9 tight).

CREATE TABLE "lobs" (
    "id"          UUID NOT NULL,
    "entity_id"   UUID NOT NULL,
    "code"        VARCHAR(64) NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "description" TEXT,
    "active"      BOOLEAN NOT NULL DEFAULT TRUE,
    "created_by"  UUID NOT NULL,
    "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_by"  UUID,
    "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "pk_lobs" PRIMARY KEY ("id")
);

ALTER TABLE "lobs"
    ADD CONSTRAINT "fk_lobs_entity_id_entities"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id")
    ON UPDATE NO ACTION;

ALTER TABLE "lobs"
    ADD CONSTRAINT "fk_lobs_created_by_users"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON UPDATE NO ACTION;

ALTER TABLE "lobs"
    ADD CONSTRAINT "fk_lobs_updated_by_users"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id")
    ON UPDATE NO ACTION;

-- Code is unique per entity (case-insensitive matching is application-layer).
CREATE UNIQUE INDEX "uq_lobs_entity_code"
    ON "lobs"("entity_id", "code");

CREATE INDEX "ix_lobs_entity_active"
    ON "lobs"("entity_id", "active");

-- Per-invoice nullable FK. SET NULL if the LOB is deleted to avoid
-- destroying invoice rows.
ALTER TABLE "invoices"
    ADD COLUMN "lob_id" UUID;

ALTER TABLE "invoices"
    ADD CONSTRAINT "fk_invoices_lob_id_lobs"
    FOREIGN KEY ("lob_id") REFERENCES "lobs"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

CREATE INDEX "ix_invoices_lob_id"
    ON "invoices"("lob_id")
    WHERE "lob_id" IS NOT NULL;

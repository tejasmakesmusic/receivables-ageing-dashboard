-- PR 3 / Gap 3 — invoice_changes table.
-- Captures field-level deltas detected during snapshot publish so analysts
-- can review exactly what shifted between week-N and week-N+1 uploads.

CREATE TABLE "invoice_changes" (
    "id"                UUID NOT NULL,
    "invoice_id"        UUID NOT NULL,
    "snapshot_id"       UUID NOT NULL,
    "prior_snapshot_id" UUID,
    "field"             VARCHAR(32) NOT NULL,
    "before_value"      JSONB NOT NULL,
    "after_value"       JSONB NOT NULL,
    "detected_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "acknowledged_at"   TIMESTAMPTZ(6),
    "acknowledged_by"   UUID,

    CONSTRAINT "pk_invoice_changes" PRIMARY KEY ("id")
);

ALTER TABLE "invoice_changes"
    ADD CONSTRAINT "fk_invoice_changes_invoice_id_invoices"
    FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "invoice_changes"
    ADD CONSTRAINT "fk_invoice_changes_snapshot_id_snapshots"
    FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id")
    ON UPDATE NO ACTION;

ALTER TABLE "invoice_changes"
    ADD CONSTRAINT "fk_invoice_changes_acknowledged_by_users"
    FOREIGN KEY ("acknowledged_by") REFERENCES "users"("id")
    ON UPDATE NO ACTION;

CREATE INDEX "ix_invoice_changes_snapshot_id"
    ON "invoice_changes"("snapshot_id");

CREATE INDEX "ix_invoice_changes_invoice_id_detected_at"
    ON "invoice_changes"("invoice_id", "detected_at" DESC);

-- Partial index keeps the "unacknowledged" lookup tight.
CREATE INDEX "ix_invoice_changes_unack"
    ON "invoice_changes"("snapshot_id")
    WHERE "acknowledged_at" IS NULL;

-- PR 8a / Gap: column-mapping introspection + persistence.
--
-- Captures what the parser actually mapped (for transparency + drift
-- detection) and the analyst's preferred default mapping per
-- (entity, source). Parsers are not yet override-driven — that's PR 8b.

CREATE TABLE "column_mappings" (
    "id"            UUID NOT NULL,
    "entity_id"     UUID NOT NULL,
    "source_hint"   VARCHAR(32) NOT NULL,
    "mapping_json"  JSONB NOT NULL,
    "created_by"    UUID NOT NULL,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_by"    UUID,
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

    CONSTRAINT "pk_column_mappings" PRIMARY KEY ("id")
);

ALTER TABLE "column_mappings"
    ADD CONSTRAINT "fk_column_mappings_entity_id_entities"
    FOREIGN KEY ("entity_id") REFERENCES "entities"("id")
    ON UPDATE NO ACTION;

ALTER TABLE "column_mappings"
    ADD CONSTRAINT "fk_column_mappings_created_by_users"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON UPDATE NO ACTION;

ALTER TABLE "column_mappings"
    ADD CONSTRAINT "fk_column_mappings_updated_by_users"
    FOREIGN KEY ("updated_by") REFERENCES "users"("id")
    ON UPDATE NO ACTION;

ALTER TABLE "column_mappings"
    ADD CONSTRAINT "ck_column_mappings_source_hint"
    CHECK ("source_hint" IN ('TALLY', 'XERO', 'CREDIT_PERIOD'));

-- One saved mapping per (entity, source). Re-uploads from the same source
-- pick this up automatically.
CREATE UNIQUE INDEX "uq_column_mappings_entity_source"
    ON "column_mappings"("entity_id", "source_hint");

-- Per-snapshot record of "what the parser actually saw" — feeds the
-- introspection card in staging and the drift warning.
ALTER TABLE "snapshots"
    ADD COLUMN "column_mapping_json" JSONB;

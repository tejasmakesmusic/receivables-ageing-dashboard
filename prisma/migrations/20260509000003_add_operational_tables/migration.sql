-- Create enums for operational models (Phase 2)
CREATE TYPE "collection_task_status" AS ENUM ('SUGGESTED', 'OPEN', 'IN_PROGRESS', 'SNOOZED', 'DONE', 'DISMISSED');
CREATE TYPE "collection_task_reason_code" AS ENUM ('NINETY_PLUS', 'STALE_FOLLOW_UP', 'HIGH_VALUE', 'DISPUTE_OPEN', 'BROKEN_PROMISE', 'MANUAL');
CREATE TYPE "collection_task_source_type" AS ENUM ('SUGGESTED', 'MANUAL');
CREATE TYPE "promise_to_pay_status" AS ENUM ('OPEN', 'KEPT', 'BROKEN', 'CANCELLED');
CREATE TYPE "dispute_case_status" AS ENUM ('OPEN', 'IN_REVIEW', 'WAITING_ON_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "digest_event_state" AS ENUM ('DRAFT', 'PREVIEWED', 'APPROVED', 'SENT', 'SKIPPED', 'FAILED');

-- collection_tasks
CREATE TABLE "collection_tasks" (
    "id"                 UUID NOT NULL,
    "entity_id"          UUID NOT NULL,
    "canonical_id"       UUID NOT NULL,
    "invoice_id"         UUID,
    "source_snapshot_id" UUID,
    "source_type"        "collection_task_source_type" NOT NULL,
    "reason_code"        "collection_task_reason_code" NOT NULL,
    "priority_score"     DECIMAL(10,2) NOT NULL,
    "status"             "collection_task_status" NOT NULL DEFAULT 'SUGGESTED',
    "owner_user_id"      UUID,
    "due_date"           DATE,
    "completed_at"       TIMESTAMPTZ(6),
    "dismissed_reason"   TEXT,
    "created_by"         UUID NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "collection_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_collection_tasks_entity_status"    ON "collection_tasks"("entity_id", "status");
CREATE INDEX "ix_collection_tasks_canonical_status" ON "collection_tasks"("canonical_id", "status");
CREATE INDEX "ix_collection_tasks_owner_status"     ON "collection_tasks"("owner_user_id", "status");

ALTER TABLE "collection_tasks"
    ADD CONSTRAINT "fk_collection_tasks_entity_id_entities"
        FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_collection_tasks_canonical_id_parties_canonical"
        FOREIGN KEY ("canonical_id") REFERENCES "parties_canonical"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_collection_tasks_invoice_id_invoices"
        FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_collection_tasks_source_snapshot_id_snapshots"
        FOREIGN KEY ("source_snapshot_id") REFERENCES "snapshots"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_collection_tasks_owner_user_id_users"
        FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_collection_tasks_created_by_users"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- promises_to_pay
CREATE TABLE "promises_to_pay" (
    "id"                 UUID NOT NULL,
    "canonical_id"       UUID NOT NULL,
    "invoice_id"         UUID,
    "collection_task_id" UUID,
    "amount"             DECIMAL(18,2) NOT NULL,
    "currency"           VARCHAR(3) NOT NULL,
    "promised_date"      DATE NOT NULL,
    "status"             "promise_to_pay_status" NOT NULL DEFAULT 'OPEN',
    "contact_person"     TEXT,
    "notes"              TEXT,
    "created_by"         UUID NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "promises_to_pay_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_promises_to_pay_canonical_status" ON "promises_to_pay"("canonical_id", "status");

ALTER TABLE "promises_to_pay"
    ADD CONSTRAINT "fk_promises_to_pay_canonical_id_parties_canonical"
        FOREIGN KEY ("canonical_id") REFERENCES "parties_canonical"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_promises_to_pay_invoice_id_invoices"
        FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_promises_to_pay_collection_task_id_collection_tasks"
        FOREIGN KEY ("collection_task_id") REFERENCES "collection_tasks"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_promises_to_pay_created_by_users"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- dispute_cases
CREATE TABLE "dispute_cases" (
    "id"                       UUID NOT NULL,
    "entity_id"                UUID NOT NULL,
    "canonical_id"             UUID NOT NULL,
    "invoice_id"               UUID,
    "reason_code"              VARCHAR(64) NOT NULL,
    "description"              TEXT NOT NULL,
    "status"                   "dispute_case_status" NOT NULL DEFAULT 'OPEN',
    "owner_user_id"            UUID,
    "expected_resolution_date" DATE,
    "resolved_at"              TIMESTAMPTZ(6),
    "resolution_note"          TEXT,
    "created_by"               UUID NOT NULL,
    "created_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"               TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "dispute_cases_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ix_dispute_cases_entity_status"    ON "dispute_cases"("entity_id", "status");
CREATE INDEX "ix_dispute_cases_canonical_status" ON "dispute_cases"("canonical_id", "status");

ALTER TABLE "dispute_cases"
    ADD CONSTRAINT "fk_dispute_cases_entity_id_entities"
        FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_dispute_cases_canonical_id_parties_canonical"
        FOREIGN KEY ("canonical_id") REFERENCES "parties_canonical"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_dispute_cases_invoice_id_invoices"
        FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_dispute_cases_owner_user_id_users"
        FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    ADD CONSTRAINT "fk_dispute_cases_created_by_users"
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- digest_events
CREATE TABLE "digest_events" (
    "id"            UUID NOT NULL,
    "digest_date"   DATE NOT NULL,
    "state"         "digest_event_state" NOT NULL DEFAULT 'DRAFT',
    "snapshot_ids"  JSONB NOT NULL DEFAULT '[]',
    "payload_json"  JSONB,
    "approved_by"   UUID,
    "sent_at"       TIMESTAMPTZ(6),
    "error_message" TEXT,
    "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "digest_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_digest_events_digest_date" ON "digest_events"("digest_date");
CREATE INDEX "ix_digest_events_state_date" ON "digest_events"("state", "digest_date");

ALTER TABLE "digest_events"
    ADD CONSTRAINT "fk_digest_events_approved_by_users"
        FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

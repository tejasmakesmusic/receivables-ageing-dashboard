-- ADR-0012: read-only Xero API ingestion for UAE snapshots.
-- Adds connection metadata and per-pull sync-run audit tables.
-- No change to `snapshots`; Xero pulls reuse `source_hint = 'XERO'` and
-- carry origin metadata inside `parse_result_json`.

CREATE TABLE "xero_connections" (
    "id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "tenant_id" VARCHAR(128) NOT NULL,
    "tenant_name" VARCHAR(255) NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "encrypted_refresh_token" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMPTZ(6),
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "connected_by" UUID NOT NULL,
    "disconnected_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "pk_xero_connections" PRIMARY KEY ("id"),
    CONSTRAINT "fk_xero_connections_entity_id_entities"
        FOREIGN KEY ("entity_id") REFERENCES "entities"("id")
        ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT "fk_xero_connections_connected_by_users"
        FOREIGN KEY ("connected_by") REFERENCES "users"("id")
        ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT "ck_xero_connections_status"
        CHECK ("status" IN ('ACTIVE', 'DISCONNECTED', 'ERROR'))
);

CREATE UNIQUE INDEX "uq_xero_connections_entity_tenant"
    ON "xero_connections" ("entity_id", "tenant_id");

CREATE INDEX "ix_xero_connections_status"
    ON "xero_connections" ("status");

CREATE TABLE "xero_sync_runs" (
    "id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "snapshot_id" UUID,
    "triggered_by" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'RUNNING',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "finished_at" TIMESTAMPTZ(6),
    "pages_fetched" INTEGER NOT NULL DEFAULT 0,
    "invoices_seen" INTEGER NOT NULL DEFAULT 0,
    "invoices_staged" INTEGER NOT NULL DEFAULT 0,
    "parse_errors" INTEGER NOT NULL DEFAULT 0,
    "source_artifact_uri" TEXT,
    "source_artifact_sha256" VARCHAR(64),
    "error_code" VARCHAR(64),
    "error_message" TEXT,
    "rate_limit_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),

    CONSTRAINT "pk_xero_sync_runs" PRIMARY KEY ("id"),
    CONSTRAINT "fk_xero_sync_runs_connection_id_xero_connections"
        FOREIGN KEY ("connection_id") REFERENCES "xero_connections"("id")
        ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT "fk_xero_sync_runs_snapshot_id_snapshots"
        FOREIGN KEY ("snapshot_id") REFERENCES "snapshots"("id")
        ON UPDATE NO ACTION ON DELETE SET NULL,
    CONSTRAINT "fk_xero_sync_runs_triggered_by_users"
        FOREIGN KEY ("triggered_by") REFERENCES "users"("id")
        ON UPDATE NO ACTION ON DELETE RESTRICT,
    CONSTRAINT "ck_xero_sync_runs_status"
        CHECK ("status" IN ('RUNNING', 'SUCCEEDED', 'FAILED'))
);

CREATE INDEX "ix_xero_sync_runs_connection_started"
    ON "xero_sync_runs" ("connection_id", "started_at" DESC);

CREATE INDEX "ix_xero_sync_runs_snapshot_id"
    ON "xero_sync_runs" ("snapshot_id");

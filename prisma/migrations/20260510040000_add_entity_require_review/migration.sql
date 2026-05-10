-- PR 10 (was PR 7b) — per-entity hard publish gate. When TRUE, a STAGED
-- snapshot must be APPROVED by a REVIEWER (or ADMIN) before it can be
-- published. Default FALSE preserves backward compatibility — existing
-- workflows where review is a soft signal continue to work.

ALTER TABLE "entities"
    ADD COLUMN "require_review_before_publish" BOOLEAN NOT NULL DEFAULT FALSE;

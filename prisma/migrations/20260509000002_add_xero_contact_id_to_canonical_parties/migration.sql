ALTER TABLE "parties_canonical" ADD COLUMN "xero_contact_id" TEXT;
CREATE INDEX "ix_parties_canonical_entity_xero_contact" ON "parties_canonical"("entity_id", "xero_contact_id") WHERE "xero_contact_id" IS NOT NULL;

-- Sub-project 1: email/password auth columns
ALTER TABLE "users"
    ADD COLUMN "password_hash"                 TEXT,
    ADD COLUMN "email_verified"                BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN "email_verification_token"      VARCHAR(64),
    ADD COLUMN "email_verification_expires_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "uq_users_email_verification_token"
    ON "users"("email_verification_token")
    WHERE "email_verification_token" IS NOT NULL;

-- Sub-project 2: OTP passwordless login + password reset columns
ALTER TABLE "users"
    ADD COLUMN "otp_code"                  VARCHAR(6),
    ADD COLUMN "otp_token"                 VARCHAR(64),
    ADD COLUMN "otp_expires_at"            TIMESTAMPTZ(6),
    ADD COLUMN "password_reset_token"      VARCHAR(64),
    ADD COLUMN "password_reset_expires_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "uq_users_otp_token"
    ON "users"("otp_token")
    WHERE "otp_token" IS NOT NULL;

CREATE UNIQUE INDEX "uq_users_password_reset_token"
    ON "users"("password_reset_token")
    WHERE "password_reset_token" IS NOT NULL;

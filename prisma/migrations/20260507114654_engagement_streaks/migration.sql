CREATE TABLE "engagement_streaks" (
  "user_id" UUID NOT NULL,
  "current_streak" INTEGER NOT NULL DEFAULT 0,
  "longest_streak" INTEGER NOT NULL DEFAULT 0,
  "last_credited_date" DATE,
  "last_evaluated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "engagement_streaks_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "engagement_streaks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "engagement_streak_freezes" (
  "freeze_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID,
  "freeze_date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "note" TEXT,
  "created_by" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "engagement_streak_freezes_pkey" PRIMARY KEY ("freeze_id"),
  CONSTRAINT "engagement_streak_freezes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "engagement_streak_freezes_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "engagement_streak_freezes_user_id_freeze_date_key"
  ON "engagement_streak_freezes"("user_id", "freeze_date");

CREATE INDEX "engagement_streak_freezes_freeze_date_idx"
  ON "engagement_streak_freezes"("freeze_date");

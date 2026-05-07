CREATE TABLE "user_saved_views" (
  "view_id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "owner_user_id" UUID NOT NULL,
  "surface" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
  "filters_json" JSONB NOT NULL,
  "sort_json" JSONB,
  "visible_columns" JSONB,
  "grouping_json" JSONB,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "user_saved_views_pkey" PRIMARY KEY ("view_id"),
  CONSTRAINT "user_saved_views_owner_user_id_fkey"
    FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "user_saved_views_owner_user_id_surface_idx"
  ON "user_saved_views"("owner_user_id", "surface");

CREATE INDEX "user_saved_views_surface_visibility_idx"
  ON "user_saved_views"("surface", "visibility");

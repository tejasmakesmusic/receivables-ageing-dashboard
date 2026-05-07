import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { assertNotPending } from "@/server/core/assertNotPending";
import { assertReadOnlyForCfo } from "@/server/core/assertReadOnlyForCfo";
import { createAuditLog } from "@/server/core/audit";
import { ForbiddenError, HttpError } from "@/server/core/errors";
import { role_enum } from "@/generated/prisma/enums";

export const SAVED_VIEW_SURFACES = [
  "invoices",
  "tasks",
  "parties",
  "promises_to_pay",
  "dispute_cases",
  "snapshots",
] as const;

export type Surface = (typeof SAVED_VIEW_SURFACES)[number];
export type SavedViewVisibility = "PRIVATE" | "PUBLIC";

export type SavedViewInput = {
  surface: Surface;
  name: string;
  visibility: SavedViewVisibility;
  filters: Record<string, unknown>;
  sort?: { key: string; direction: "asc" | "desc" } | null;
  visible_columns?: string[];
  grouping?: { key: string } | null;
  pinned?: boolean;
};

export type SavedView = {
  view_id: string;
  owner_user_id: string;
  surface: Surface;
  name: string;
  visibility: SavedViewVisibility;
  filters: Record<string, unknown>;
  sort: SavedViewInput["sort"] | null;
  visible_columns: string[] | null;
  grouping: SavedViewInput["grouping"] | null;
  pinned: boolean;
  created_at: Date;
  updated_at: Date;
};

type SavedViewRow = {
  view_id: string;
  owner_user_id: string;
  surface: string;
  name: string;
  visibility: string;
  filters_json: Prisma.JsonValue;
  sort_json: Prisma.JsonValue | null;
  visible_columns: Prisma.JsonValue | null;
  grouping_json: Prisma.JsonValue | null;
  pinned: boolean;
  created_at: Date;
  updated_at: Date;
};

const SAVED_VIEW_VISIBILITIES = ["PRIVATE", "PUBLIC"] as const;

function isSurface(value: unknown): value is Surface {
  return (
    typeof value === "string" &&
    SAVED_VIEW_SURFACES.includes(value as Surface)
  );
}

function isVisibility(value: unknown): value is SavedViewVisibility {
  return (
    typeof value === "string" &&
    SAVED_VIEW_VISIBILITIES.includes(value as SavedViewVisibility)
  );
}

function assertValidName(name: unknown): string {
  if (typeof name !== "string") {
    throw new HttpError("validation_error", 400, "name must be a string");
  }

  const trimmed = name.trim();

  if (!trimmed) {
    throw new HttpError("validation_error", 400, "name must not be empty");
  }

  if (trimmed.length > 64) {
    throw new HttpError(
      "validation_error",
      400,
      "name must be 64 characters or fewer",
    );
  }

  return trimmed;
}

function assertValidSurface(surface: unknown): Surface {
  if (!isSurface(surface)) {
    throw new HttpError("validation_error", 400, "Invalid saved view surface");
  }

  return surface;
}

function assertValidVisibility(visibility: unknown): SavedViewVisibility {
  if (!isVisibility(visibility)) {
    throw new HttpError(
      "validation_error",
      400,
      "Invalid saved view visibility",
    );
  }

  return visibility;
}

function assertAdminForPublic(
  visibility: SavedViewVisibility,
  user: AuthenticatedUser,
): void {
  if (visibility === "PUBLIC" && user.role !== role_enum.ADMIN) {
    throw new ForbiddenError("Only ADMIN users can manage PUBLIC saved views");
  }
}

function assertCanMutateSavedView(
  view: Pick<SavedViewRow, "owner_user_id" | "visibility">,
  user: AuthenticatedUser,
): void {
  if (view.visibility === "PUBLIC") {
    if (user.role !== role_enum.ADMIN) {
      throw new ForbiddenError("Only ADMIN users can mutate PUBLIC saved views");
    }
    return;
  }

  if (view.owner_user_id !== user.id) {
    throw new ForbiddenError("Only the owner can mutate PRIVATE saved views");
  }
}

function assertRecord(value: unknown, field: string): Record<string, unknown> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new HttpError("validation_error", 400, `${field} must be an object`);
  }

  return value as Record<string, unknown>;
}

function toNullableJson(value: unknown) {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }

  return value as Prisma.InputJsonValue;
}

function toSavedView(row: SavedViewRow): SavedView {
  return {
    view_id: row.view_id,
    owner_user_id: row.owner_user_id,
    surface: row.surface as Surface,
    name: row.name,
    visibility: row.visibility as SavedViewVisibility,
    filters: row.filters_json as Record<string, unknown>,
    sort: row.sort_json as SavedViewInput["sort"] | null,
    visible_columns: row.visible_columns as string[] | null,
    grouping: row.grouping_json as SavedViewInput["grouping"] | null,
    pinned: row.pinned,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toAuditPayload(view: SavedView): Record<string, unknown> {
  return {
    view_id: view.view_id,
    owner_user_id: view.owner_user_id,
    surface: view.surface,
    name: view.name,
    visibility: view.visibility,
    filters: view.filters,
    sort: view.sort,
    visible_columns: view.visible_columns,
    grouping: view.grouping,
    pinned: view.pinned,
    created_at: view.created_at.toISOString(),
    updated_at: view.updated_at.toISOString(),
  };
}

function validateCreateInput(input: SavedViewInput): SavedViewInput {
  const surface = assertValidSurface(input.surface);
  const visibility = assertValidVisibility(input.visibility);

  return {
    surface,
    name: assertValidName(input.name),
    visibility,
    filters: assertRecord(input.filters, "filters"),
    sort: input.sort ?? null,
    visible_columns: input.visible_columns,
    grouping: input.grouping ?? null,
    pinned: input.pinned ?? false,
  };
}

function validatePatchInput(
  patch: Partial<SavedViewInput>,
): Partial<SavedViewInput> {
  return {
    ...(patch.surface !== undefined
      ? { surface: assertValidSurface(patch.surface) }
      : {}),
    ...(patch.name !== undefined ? { name: assertValidName(patch.name) } : {}),
    ...(patch.visibility !== undefined
      ? { visibility: assertValidVisibility(patch.visibility) }
      : {}),
    ...(patch.filters !== undefined
      ? { filters: assertRecord(patch.filters, "filters") }
      : {}),
    ...(patch.sort !== undefined ? { sort: patch.sort ?? null } : {}),
    ...(patch.visible_columns !== undefined
      ? { visible_columns: patch.visible_columns }
      : {}),
    ...(patch.grouping !== undefined
      ? { grouping: patch.grouping ?? null }
      : {}),
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
  };
}

export async function listSavedViews(
  filter: { surface?: Surface },
  currentUser: AuthenticatedUser,
): Promise<SavedView[]> {
  assertNotPending(currentUser);

  const surface =
    filter.surface === undefined ? undefined : assertValidSurface(filter.surface);

  const rows = await getPrisma().user_saved_views.findMany({
    where: {
      OR: [
        { owner_user_id: currentUser.id },
        { visibility: "PUBLIC" },
      ],
      ...(surface ? { surface } : {}),
    },
    orderBy: [{ pinned: "desc" }, { updated_at: "desc" }, { name: "asc" }],
  });

  return rows.map((row) => toSavedView(row));
}

export async function createSavedView(
  input: SavedViewInput,
  currentUser: AuthenticatedUser,
): Promise<SavedView> {
  assertNotPending(currentUser);
  assertReadOnlyForCfo(currentUser);

  const validated = validateCreateInput(input);
  assertAdminForPublic(validated.visibility, currentUser);

  const created = await getPrisma().user_saved_views.create({
    data: {
      owner_user_id: currentUser.id,
      surface: validated.surface,
      name: validated.name,
      visibility: validated.visibility,
      filters_json: validated.filters as Prisma.InputJsonValue,
      sort_json: toNullableJson(validated.sort),
      visible_columns: toNullableJson(validated.visible_columns),
      grouping_json: toNullableJson(validated.grouping),
      pinned: validated.pinned ?? false,
    },
  });
  const savedView = toSavedView(created);

  await createAuditLog(
    currentUser.id,
    "user_saved_view.create",
    "user_saved_views",
    savedView.view_id,
    Prisma.JsonNull,
    toAuditPayload(savedView),
  );

  return savedView;
}

export async function updateSavedView(
  viewId: string,
  patch: Partial<SavedViewInput>,
  currentUser: AuthenticatedUser,
): Promise<SavedView> {
  assertNotPending(currentUser);
  assertReadOnlyForCfo(currentUser);

  const validated = validatePatchInput(patch);

  if (validated.visibility) {
    assertAdminForPublic(validated.visibility, currentUser);
  }

  const existing = await getPrisma().user_saved_views.findUnique({
    where: { view_id: viewId },
  });

  if (!existing) {
    throw new HttpError("not_found", 404, "Saved view not found");
  }

  assertCanMutateSavedView(existing, currentUser);

  const before = toSavedView(existing);
  const updated = await getPrisma().user_saved_views.update({
    where: { view_id: viewId },
    data: {
      ...(validated.surface !== undefined ? { surface: validated.surface } : {}),
      ...(validated.name !== undefined ? { name: validated.name } : {}),
      ...(validated.visibility !== undefined
        ? { visibility: validated.visibility }
        : {}),
      ...(validated.filters !== undefined
        ? { filters_json: validated.filters as Prisma.InputJsonValue }
        : {}),
      ...(validated.sort !== undefined
        ? { sort_json: toNullableJson(validated.sort) }
        : {}),
      ...(validated.visible_columns !== undefined
        ? { visible_columns: toNullableJson(validated.visible_columns) }
        : {}),
      ...(validated.grouping !== undefined
        ? { grouping_json: toNullableJson(validated.grouping) }
        : {}),
      ...(validated.pinned !== undefined ? { pinned: validated.pinned } : {}),
    },
  });
  const savedView = toSavedView(updated);

  await createAuditLog(
    currentUser.id,
    "user_saved_view.update",
    "user_saved_views",
    viewId,
    toAuditPayload(before),
    toAuditPayload(savedView),
  );

  return savedView;
}

export async function deleteSavedView(
  viewId: string,
  currentUser: AuthenticatedUser,
): Promise<void> {
  assertNotPending(currentUser);
  assertReadOnlyForCfo(currentUser);

  const existing = await getPrisma().user_saved_views.findUnique({
    where: { view_id: viewId },
  });

  if (!existing) {
    throw new HttpError("not_found", 404, "Saved view not found");
  }

  assertCanMutateSavedView(existing, currentUser);

  const before = toSavedView(existing);

  await getPrisma().user_saved_views.delete({
    where: { view_id: viewId },
  });

  await createAuditLog(
    currentUser.id,
    "user_saved_view.delete",
    "user_saved_views",
    viewId,
    toAuditPayload(before),
    Prisma.JsonNull,
  );
}

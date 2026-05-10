import "server-only";
import { role_enum } from "@/generated/prisma/enums";
import { requireRole } from "@/server/core/auth";
import {
  listSavedViews,
  type SavedView,
  type Surface,
} from "@/server/views/user-views";

export async function listSavedViewsForCurrentUser(
  surface: Surface,
): Promise<SavedView[]> {
  const currentUser = await requireRole(
    role_enum.ANALYST,
    role_enum.CFO,
    role_enum.REVIEWER,
    role_enum.ADMIN,
  );

  return listSavedViews({ surface }, currentUser);
}

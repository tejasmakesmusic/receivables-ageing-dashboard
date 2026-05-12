import { role_enum } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/core/errors";
import type { AuthenticatedUser } from "@/server/core/auth";

/**
 * Throws ForbiddenError if the authenticated user is in a read-only role.
 * Call at the top of every non-GET route handler to enforce read-only access
 * for CFO and REVIEWER users.
 *
 * REVIEWER may only mutate snapshot review state via the dedicated
 * /api/snapshots/:id/review endpoint, which doesn't call this guard.
 */
export function assertReadOnlyForCfo(user: AuthenticatedUser): void {
  if (user.role === role_enum.CFO || user.role === role_enum.REVIEWER) {
    throw new ForbiddenError(
      `${user.role} users have read-only access to operational data`,
    );
  }
}

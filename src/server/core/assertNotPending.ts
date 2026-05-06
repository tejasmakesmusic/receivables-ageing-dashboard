import { role_enum } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/core/errors";
import type { AuthenticatedUser } from "@/server/core/auth";

/**
 * Throws ForbiddenError if the authenticated user has the PENDING role.
 * Call at the top of every handler that returns AR data (including GETs) to
 * prevent pending users from observing any receivables data before approval.
 */
export function assertNotPending(user: AuthenticatedUser): void {
  if (user.role === role_enum.PENDING) {
    throw new ForbiddenError("Account is pending approval");
  }
}

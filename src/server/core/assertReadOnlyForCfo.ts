import { role_enum } from "@/generated/prisma/enums";
import { ForbiddenError } from "@/server/core/errors";
import type { AuthenticatedUser } from "@/server/core/auth";

/**
 * Throws ForbiddenError if the authenticated user has the CFO role.
 * Call at the top of every non-GET route handler to enforce read-only access
 * for CFO users.
 */
export function assertReadOnlyForCfo(user: AuthenticatedUser): void {
  if (user.role === role_enum.CFO) {
    throw new ForbiddenError("CFO users have read-only access");
  }
}

import { redirect } from "next/navigation";
import { requireRole, type AuthenticatedUser, type Role } from "./auth";
import { ForbiddenError, UnauthorizedError } from "./errors";

export async function requirePageRole(
  nextPath: string,
  ...roles: Role[]
): Promise<AuthenticatedUser> {
  try {
    return await requireRole(...roles);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
    }

    if (error instanceof ForbiddenError) {
      redirect("/auth/pending");
    }

    throw error;
  }
}

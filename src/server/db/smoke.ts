import { getPrisma } from "@/lib/prisma";

export type DbHealthStatus = "ok" | "error";
export type DbHealthResult = {
  status: DbHealthStatus;
  detail?: string;
};

export async function getDbHealthStatus(): Promise<DbHealthResult> {
  try {
    await getPrisma().$queryRaw`SELECT 1::int AS ok`;
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      detail:
        process.env.NODE_ENV === "production"
          ? undefined
          : error instanceof Error
            ? error.message
            : "Unknown database error",
    };
  }
}

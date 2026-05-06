import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env, toPrismaDatabaseUrl } from "./env";

const globalForPrisma = globalThis as {
  prisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to create Prisma client.");
  }

  const connectionString = toPrismaDatabaseUrl(env.DATABASE_URL);
  const adapter =
    resolveDatabaseAdapter(connectionString) === "pg"
      ? new PrismaPg({ connectionString })
      : new PrismaNeon({ connectionString });

  return new PrismaClient({
    adapter,
  });
}

function resolveDatabaseAdapter(connectionString: string): "neon" | "pg" {
  if (env.DATABASE_ADAPTER) {
    return env.DATABASE_ADAPTER;
  }

  const hostname = new URL(connectionString).hostname.toLowerCase();
  return ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(
    hostname,
  )
    ? "pg"
    : "neon";
}

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

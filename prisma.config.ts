import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

const cliDatabaseUrl =
  process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;

function toPrismaDatabaseUrl(databaseUrl: string): string {
  return databaseUrl
    .replace(/^postgresql\+psycopg:\/\//, "postgresql://")
    .replace(/^postgres\+psycopg:\/\//, "postgres://");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  ...(cliDatabaseUrl
    ? {
        datasource: {
          url: toPrismaDatabaseUrl(cliDatabaseUrl),
        },
      }
    : {}),
});

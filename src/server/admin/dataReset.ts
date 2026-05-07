import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { role_enum } from "@/generated/prisma/enums";
import { createId } from "@/lib/ids";
import { getPrisma } from "@/lib/prisma";
import type { AuthenticatedUser } from "@/server/core/auth";
import { ForbiddenError, HttpError } from "@/server/core/errors";

export const DATA_RESET_CONFIRMATION_PHRASE = "RESET IMPORTED DATA";

export const IMPORTED_DATA_RESET_TABLES = [
  "email_outbox",
  "digest_events",
  "promises_to_pay",
  "dispute_cases",
  "follow_ups",
  "exception_tags",
  "collection_tasks",
  "invoice_snapshots",
  "invoices",
  "reconciliation_entries",
  "snapshots",
] as const;

export const PRESERVED_DATA_RESET_TABLES = [
  "audit_log",
  "users",
  "entities",
  "credit_period_config",
  "fx_rates",
  "email_rules",
  "exception_bucket_types",
  "parties_canonical",
  "party_aliases",
] as const;

export type ImportedDataResetTable =
  (typeof IMPORTED_DATA_RESET_TABLES)[number];

export type ImportedDataResetCounts = Record<ImportedDataResetTable, number>;

export interface ImportedDataResetInput {
  confirmation: string;
}

export interface ImportedDataResetPreview {
  confirmation_phrase: typeof DATA_RESET_CONFIRMATION_PHRASE;
  counts: ImportedDataResetCounts;
  preserved: readonly string[];
}

export interface ImportedDataResetResult {
  reset_type: "imported_receivables";
  before: ImportedDataResetCounts;
  deleted: ImportedDataResetCounts;
  preserved: readonly string[];
}

type ResetModelDelegate = {
  count(): Promise<number>;
  deleteMany(): Promise<{ count: number }>;
};

type AuditLogDelegate = {
  create(args: {
    data: {
      id: string;
      actor_user_id: string;
      action: string;
      entity_type: string;
      entity_id: string | null;
      before: Prisma.InputJsonValue;
      after: Prisma.InputJsonValue;
    };
  }): Promise<unknown>;
};

type ResetPrismaClient = Record<ImportedDataResetTable, ResetModelDelegate> & {
  audit_log: AuditLogDelegate;
  $transaction<T>(
    callback: (tx: Record<ImportedDataResetTable, ResetModelDelegate> & {
      audit_log: AuditLogDelegate;
    }) => Promise<T>,
  ): Promise<T>;
};

function assertAdmin(user: AuthenticatedUser) {
  if (user.role !== role_enum.ADMIN) {
    throw new ForbiddenError("Only admins can reset imported receivables data");
  }
}

function assertConfirmation(confirmation: string) {
  if (confirmation !== DATA_RESET_CONFIRMATION_PHRASE) {
    throw new HttpError(
      "invalid_confirmation",
      422,
      `Type ${DATA_RESET_CONFIRMATION_PHRASE} to reset imported data.`,
    );
  }
}

function emptyCounts(): ImportedDataResetCounts {
  return IMPORTED_DATA_RESET_TABLES.reduce((acc, table) => {
    acc[table] = 0;
    return acc;
  }, {} as ImportedDataResetCounts);
}

async function countImportedData(
  prisma: Pick<ResetPrismaClient, ImportedDataResetTable>,
): Promise<ImportedDataResetCounts> {
  const counts = emptyCounts();

  await Promise.all(
    IMPORTED_DATA_RESET_TABLES.map(async (table) => {
      counts[table] = await prisma[table].count();
    }),
  );

  return counts;
}

function resetPrisma() {
  return getPrisma() as unknown as ResetPrismaClient;
}

export async function getImportedDataResetPreview(
  user: AuthenticatedUser,
): Promise<ImportedDataResetPreview> {
  assertAdmin(user);

  return {
    confirmation_phrase: DATA_RESET_CONFIRMATION_PHRASE,
    counts: await countImportedData(resetPrisma()),
    preserved: PRESERVED_DATA_RESET_TABLES,
  };
}

export async function resetImportedReceivablesData(
  input: ImportedDataResetInput,
  user: AuthenticatedUser,
): Promise<ImportedDataResetResult> {
  assertAdmin(user);
  assertConfirmation(input.confirmation);

  const prisma = resetPrisma();
  const before = await countImportedData(prisma);
  const deleted = emptyCounts();

  await prisma.$transaction(async (tx) => {
    for (const table of IMPORTED_DATA_RESET_TABLES) {
      const result = await tx[table].deleteMany();
      deleted[table] = result.count;
    }

    await tx.audit_log.create({
      data: {
        id: createId(),
        actor_user_id: user.id,
        action: "admin.data_reset.imported_receivables",
        entity_type: "admin_data_reset",
        entity_id: null,
        before: before as Prisma.InputJsonValue,
        after: {
          deleted,
          preserved: PRESERVED_DATA_RESET_TABLES,
        } as Prisma.InputJsonValue,
      },
    });
  });

  return {
    reset_type: "imported_receivables",
    before,
    deleted,
    preserved: PRESERVED_DATA_RESET_TABLES,
  };
}

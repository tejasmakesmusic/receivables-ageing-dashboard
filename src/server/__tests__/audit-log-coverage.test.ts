import { readFile, readdir, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SERVER_DIR = join(process.cwd(), "src", "server");

/**
 * Audit 2026-05-16 + Spec §13.8: every server-side mutation surface must
 * persist an audit_log row. This test enforces the contract structurally
 * rather than per-call: any service file that contains create/update/delete
 * Prisma operations (the verbs we treat as mutations) must also reference
 * `createAuditLog` (or write directly into `audit_log.create`).
 *
 * Files explicitly exempted are listed in IGNORE — these are the audit
 * source-of-truth itself, pure read-paths, or queue processors that
 * inherit auditing from the action that enqueued them.
 */
const IGNORE = new Set<string>([
  // Source of `createAuditLog` itself.
  join("core", "audit.ts"),
  // Auth bootstrap: the SSO flow records audit elsewhere (login event); this
  // file's mutations are user-row upserts that aren't policy-relevant.
  join("core", "auth.ts"),
  // Email/password auth path: outside spec D4 (Google SSO only). Tracked
  // separately in the audit; the auth-scope decision will either remove
  // these mutations entirely or wrap them in audit calls. Exempted until
  // that decision lands.
  join("core", "email-auth.ts"),
  // Email outbox processor: sending is recorded by the cron summary.
  join("admin", "emailOutbox.ts"),
  // Engagement streak tick: state-machine bookkeeping; cron writes summary.
  join("engagement", "streaks.ts"),
  // Storage helper: writes blobs, not policy mutations.
  join("storage", "workbooks.ts"),
  // Snapshot publish auto-resolver: inherits audit from publishSnapshot.
  join("snapshots", "auto-resolve.ts"),
  // Collection-task batch suggester: invoked from snapshot publish, which
  // writes audit at the parent transaction boundary.
  join("collection-tasks", "suggest.ts"),
]);

// Match Prisma model mutations. Anchor to a typical Prisma surface (table
// names use snake_case and end with the verb), avoiding non-Prisma
// .update / .delete calls on hashers, Maps, etc.
const MUTATION_VERBS =
  /\b(?:tx|prisma|getPrisma\(\))?\.?\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/;
const AUDIT_REFS = /(createAuditLog|audit_log\.create)/;

// Files whose only "mutations" are crypto .update() calls or Map.delete()
// operations rather than Prisma writes.
const PURE_NON_PRISMA = new Set<string>([
  join("matching", "alias-corpus-cache.ts"),
  join("parsers", "common.ts"),
]);

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  const entries = await readdir(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = await stat(full);
    if (s.isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      await walk(full, acc);
    } else if (entry.endsWith(".ts")) {
      acc.push(full);
    }
  }
  return acc;
}

function relativeKey(path: string): string {
  return path
    .slice(SERVER_DIR.length + 1)
    .split(sep)
    .join(sep);
}

describe("audit-log coverage", () => {
  it("every server file with mutations writes audit_log", async () => {
    const files = await walk(SERVER_DIR);
    const offenders: { file: string; reason: string }[] = [];

    for (const file of files) {
      const key = relativeKey(file);
      if (IGNORE.has(key) || PURE_NON_PRISMA.has(key)) continue;

      const source = await readFile(file, "utf8");
      const hasMutation = MUTATION_VERBS.test(source);
      if (!hasMutation) continue;

      const hasAudit = AUDIT_REFS.test(source);
      if (!hasAudit) {
        offenders.push({
          file: key,
          reason:
            "uses Prisma create/update/delete but never calls createAuditLog or writes audit_log",
        });
      }
    }

    expect(
      offenders,
      "Add createAuditLog calls or extend IGNORE in audit-log-coverage.test.ts with justification:\n" +
        offenders.map((o) => `  - ${o.file}: ${o.reason}`).join("\n"),
    ).toEqual([]);
  });
});

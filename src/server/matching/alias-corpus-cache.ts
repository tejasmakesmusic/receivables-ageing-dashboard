import { getPrisma } from "@/lib/prisma";
import type { CanonicalParty } from "@/server/matching/fuse-alias";

/**
 * PR C+ — per-entity in-process cache for the alias corpus.
 *
 * The corpus (canonical parties + their aliases) is loaded on every
 * staging-page hit, costing ~500ms of Neon RTT in dev. It also rarely
 * changes — analysts add a few aliases per uploaded snapshot, and the
 * corpus only ever grows. We can cache aggressively as long as we
 * invalidate on the two mutation paths that touch it:
 *
 *   • patchStagingRow `create_canonical` — adds a party + alias
 *   • patchStagingRow `resolve_alias` with `create_alias: true` — adds
 *     an alias
 *
 * (Admin party-create endpoints would also need to invalidate, but no
 * such endpoint exists today — analysts mint canonicals via staging.)
 *
 * Storage is a module-level Map. Works for:
 *   - Single dev server (one process)
 *   - Vercel Fluid Compute (instances are reused; reads from the same
 *     instance see cached data, others repopulate on first hit)
 *   - Multi-instance prod with no shared cache: each instance has its
 *     own copy. Slightly stale data is acceptable here (analysts
 *     resolve aliases interactively and immediately router.refresh()
 *     which goes back through the same instance via sticky sessions).
 *
 * TTL is a safety net. Explicit invalidation is the primary mechanism.
 */

const TTL_MS = 5 * 60 * 1000; // 5 min — invalidation does the real work

interface CacheEntry {
  loadedAt: number;
  corpus: CanonicalParty[];
}

const cache = new Map<string, CacheEntry>();

async function loadFromDb(entityId: string): Promise<CanonicalParty[]> {
  const parties = await getPrisma().parties_canonical.findMany({
    where: { entity_id: entityId },
    select: {
      id: true,
      name: true,
      gstin: true,
      xero_contact_id: true,
      party_aliases: {
        select: { alias_text: true },
      },
    },
    orderBy: { name: "asc" },
  });
  return parties.map((party) => ({
    canonicalId: party.id,
    canonicalName: party.name,
    aliases: party.party_aliases.map((alias) => alias.alias_text),
    gstin: party.gstin,
    xeroContactId: party.xero_contact_id,
  }));
}

export async function loadCachedAliasCorpus(
  entityId: string,
): Promise<CanonicalParty[]> {
  const now = Date.now();
  const hit = cache.get(entityId);
  if (hit && now - hit.loadedAt < TTL_MS) {
    return hit.corpus;
  }
  const corpus = await loadFromDb(entityId);
  cache.set(entityId, { loadedAt: now, corpus });
  return corpus;
}

/**
 * Drop the cached corpus for an entity. Call this right after any
 * transaction that mutates parties_canonical or party_aliases for that
 * entity so the next read picks up the fresh data.
 */
export function invalidateAliasCorpus(entityId: string): void {
  cache.delete(entityId);
}

/**
 * Test helper — purge everything. Not exposed to production paths.
 */
export function __resetAliasCorpusCacheForTest(): void {
  cache.clear();
}

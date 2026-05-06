import Fuse from "fuse.js";

export type ResolutionState = "EXACT" | "FUZZY_HIGH" | "FUZZY_LOW" | "UNMAPPED";

export type MatchSource = "CANONICAL_NAME" | "ALIAS";

export interface CanonicalParty {
  canonicalId: string;
  canonicalName: string;
  aliases?: string[];
}

export interface AliasCandidate {
  canonicalId: string;
  canonicalName: string;
  matchedOn: MatchSource;
  matchedText: string;
  ratio: number;
  isExact: boolean;
}

export interface AliasResolution {
  rawName: string;
  resolutionState: ResolutionState;
  topMatches: AliasCandidate[];
}

export interface AliasCorpusEntry {
  canonicalId: string;
  canonicalName: string;
  matchedText: string;
  matchedOn: MatchSource;
  normalizedText: string;
}

const WS = /\s+/g;

function normalizePartyText(value: string): string {
  return value.replace(WS, " ").trim().toLowerCase();
}

function buildCorpus(parties: CanonicalParty[]): AliasCorpusEntry[] {
  const entries: AliasCorpusEntry[] = [];

  for (const party of parties) {
    entries.push({
      canonicalId: party.canonicalId,
      canonicalName: party.canonicalName,
      matchedText: party.canonicalName,
      matchedOn: "CANONICAL_NAME",
      normalizedText: normalizePartyText(party.canonicalName),
    });

    for (const alias of party.aliases ?? []) {
      entries.push({
        canonicalId: party.canonicalId,
        canonicalName: party.canonicalName,
        matchedText: alias,
        matchedOn: "ALIAS",
        normalizedText: normalizePartyText(alias),
      });
    }
  }

  return entries;
}

function classifyByRatio(
  ratio: number,
  high: number,
  low: number,
): ResolutionState {
  if (ratio >= high) {
    return "FUZZY_HIGH";
  }
  if (ratio >= low) {
    return "FUZZY_LOW";
  }
  return "UNMAPPED";
}

function scoreToRatio(score: number): number {
  const bounded = Math.max(0, Math.min(1, score));
  return (1 - bounded) * 100;
}

function ratioFromScore(score: number | undefined): number {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return 0;
  }
  return scoreToRatio(score);
}

function buildMatcher(entries: AliasCorpusEntry[]) {
  const fuse = new Fuse(entries, {
    keys: ["normalizedText"],
    includeScore: true,
    minMatchCharLength: 1,
    ignoreLocation: true,
    shouldSort: true,
    useExtendedSearch: false,
    includeMatches: false,
    threshold: 0.45,
  });
  return fuse;
}

function exactMatch(
  entries: AliasCorpusEntry[],
  rawName: string,
): AliasResolution | null {
  const normalizedRaw = normalizePartyText(rawName);
  const exact = entries.find((entry) => entry.normalizedText === normalizedRaw);
  if (!exact) {
    return null;
  }

  return {
    rawName,
    resolutionState: "EXACT",
    topMatches: [
      {
        canonicalId: exact.canonicalId,
        canonicalName: exact.canonicalName,
        matchedOn: exact.matchedOn,
        matchedText: exact.matchedText,
        ratio: 100,
        isExact: true,
      },
    ],
  };
}

function fuzzyMatch(
  entries: AliasCorpusEntry[],
  rawName: string,
  highThreshold: number,
  lowThreshold: number,
  matchEngine: Fuse<AliasCorpusEntry>,
): AliasResolution {
  const normalizedRaw = normalizePartyText(rawName);
  const results = matchEngine.search(normalizedRaw);
  const byCanonical = new Map<
    string,
    { score: number; entry: AliasCorpusEntry }
  >();

  for (const result of results) {
    if (typeof result.score !== "number") {
      continue;
    }
    const entry = entries[result.refIndex];
    const existing = byCanonical.get(entry.canonicalId);
    if (!existing || result.score < existing.score) {
      byCanonical.set(entry.canonicalId, { score: result.score, entry });
    }
  }

  const ranked = [...byCanonical.values()]
    .sort((a, b) => a.score - b.score)
    .map((item) => ({
      ratio: Math.round(scoreToRatio(item.score)),
      score: item.score,
      entry: item.entry,
    }));

  const top = ranked.slice(0, 3);
  const topRatioScaled = ratioFromScore(top[0]?.score);

  const state = classifyByRatio(topRatioScaled, highThreshold, lowThreshold);

  return {
    rawName,
    resolutionState: state,
    topMatches: top.map((item) => ({
      canonicalId: item.entry.canonicalId,
      canonicalName: item.entry.canonicalName,
      matchedOn: item.entry.matchedOn,
      matchedText: item.entry.matchedText,
      ratio: item.ratio,
      isExact: false,
    })),
  };
}

export function resolveAlias(
  rawName: string,
  parties: CanonicalParty[],
  options?: {
    highThreshold?: number;
    lowThreshold?: number;
  },
): AliasResolution {
  const corpus = buildCorpus(parties);
  if (corpus.length === 0) {
    return {
      rawName,
      resolutionState: "UNMAPPED",
      topMatches: [],
    };
  }

  const exact = exactMatch(corpus, rawName);
  if (exact) {
    return exact;
  }

  const engine = buildMatcher(corpus);
  const high = options?.highThreshold ?? 90;
  const low = options?.lowThreshold ?? 70;

  return fuzzyMatch(corpus, rawName, high, low, engine);
}

export function resolveAliasBatch(
  rawNames: string[],
  parties: CanonicalParty[],
  options?: {
    highThreshold?: number;
    lowThreshold?: number;
  },
): AliasResolution[] {
  const corpus = buildCorpus(parties);

  if (corpus.length === 0) {
    return rawNames.map((rawName) => ({
      rawName,
      resolutionState: "UNMAPPED",
      topMatches: [],
    }));
  }

  const engine = buildMatcher(corpus);
  const high = options?.highThreshold ?? 90;
  const low = options?.lowThreshold ?? 70;

  return rawNames.map((rawName) => {
    const exact = exactMatch(corpus, rawName);
    if (exact) {
      return exact;
    }

    return fuzzyMatch(corpus, rawName, high, low, engine);
  });
}

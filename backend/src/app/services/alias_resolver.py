"""Alias resolver service — fuzzy party-name matching (spec §2 D11, M3 Task 3).

Public interface::

    resolve_alias(raw_name, entity_id, db) -> AliasResolution
    resolve_aliases_batch(raw_names, entity_id, db) -> list[AliasResolution]

Resolution states (spec §2 D11):
- EXACT      : case-insensitive + whitespace-normalised exact hit in party_aliases
               OR canonical name.
- FUZZY_HIGH : best token_sort_ratio >= 90 (but not EXACT).
- FUZZY_LOW  : best token_sort_ratio in [70, 89].
- UNMAPPED   : best ratio < 70, or no canonicals exist for the entity.

Performance:
- Corpus (canonicals + aliases) is loaded once per call to _load_corpus.
- Normalised candidate texts are pre-computed at corpus-load time and stored
  on each _CorpusEntry (norm_text field) — so repeated calls in batch mode
  do not re-normalise the same 10k entries on every raw name.
- Fuzzy scoring uses rapidfuzz.process.extract (C extension, vectorised),
  which is ~10x faster than looping over fuzz.token_sort_ratio in Python.
  Target: 1 000 raw names × 1 000 candidates ≤ 1 second.

Guardrails (CLAUDE.md):
- No datetime.today() / datetime.now().
- No print statements — structlog with aggregate counts only; no raw party names.
- No DB writes — strictly read-only.
- No new runtime deps (rapidfuzz is already in pyproject.toml).
- Entity-scoped: only considers parties_canonical + party_aliases for supplied entity_id.
"""

from __future__ import annotations

import re
import uuid
from typing import TYPE_CHECKING, Literal

import structlog
from pydantic import BaseModel, ConfigDict
from rapidfuzz import fuzz
from rapidfuzz import process as rfprocess
from sqlalchemy import select

from app.db.models.party import PartyAlias, PartyCanonical

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

_WS_RUN = re.compile(r"\s+")


def _normalise(text: str) -> str:
    """Strip leading/trailing whitespace; collapse internal runs to single space.

    Applied before comparison.  Case-folding is applied separately:
    - For EXACT check: casefold() on both sides.
    - For FUZZY: rapidfuzz handles case internally via the scorer.
    """
    return _WS_RUN.sub(" ", text.strip())


# ---------------------------------------------------------------------------
# Pydantic result models
# ---------------------------------------------------------------------------


class AliasCandidate(BaseModel):
    """One candidate from the alias corpus with its match score."""

    model_config = ConfigDict(frozen=True)

    canonical_id: uuid.UUID
    canonical_name: str
    matched_on: Literal["CANONICAL_NAME", "ALIAS"]
    matched_text: str  # the alias_text or canonical name that produced the score
    ratio: int  # 0–100 (rounded from rapidfuzz float)
    is_exact: bool


class AliasResolution(BaseModel):
    """Result of resolving a single raw party name (spec §2 D11)."""

    model_config = ConfigDict(frozen=True)

    raw_name: str
    resolution_state: Literal["EXACT", "FUZZY_HIGH", "FUZZY_LOW", "UNMAPPED"]
    top_matches: list[AliasCandidate]  # up to 3, highest-ratio first


# ---------------------------------------------------------------------------
# Internal: corpus entry + loading
# ---------------------------------------------------------------------------


class _CorpusEntry:
    """Lightweight struct for one candidate in the alias corpus.

    ``norm_text`` is pre-computed at construction time so batch resolution
    does not re-normalise the same corpus on every raw name.
    """

    __slots__ = ("canonical_id", "canonical_name", "matched_text", "norm_text", "matched_on")

    def __init__(
        self,
        canonical_id: uuid.UUID,
        canonical_name: str,
        matched_text: str,
        matched_on: Literal["CANONICAL_NAME", "ALIAS"],
    ) -> None:
        self.canonical_id = canonical_id
        self.canonical_name = canonical_name
        self.matched_text = matched_text
        self.norm_text: str = _normalise(matched_text)  # pre-computed once
        self.matched_on = matched_on


def _load_corpus(entity_id: uuid.UUID, db: Session) -> list[_CorpusEntry]:
    """Load all canonicals + aliases for *entity_id* into a flat list.

    Emits exactly 2 queries:
    1. SELECT id, name FROM parties_canonical WHERE entity_id = :entity_id
    2. SELECT alias_text, canonical_id FROM party_aliases
       WHERE canonical_id IN (<ids from query 1>)

    Returns an empty list if no canonicals exist (UNMAPPED path).
    """
    # Query 1: canonical names
    canonical_rows = db.execute(
        select(PartyCanonical.id, PartyCanonical.name).where(PartyCanonical.entity_id == entity_id)
    ).fetchall()

    if not canonical_rows:
        return []

    canonical_id_to_name: dict[uuid.UUID, str] = {row.id: row.name for row in canonical_rows}

    entries: list[_CorpusEntry] = []

    # Add canonical names as corpus entries
    for cid, cname in canonical_id_to_name.items():
        entries.append(
            _CorpusEntry(
                canonical_id=cid,
                canonical_name=cname,
                matched_text=cname,
                matched_on="CANONICAL_NAME",
            )
        )

    # Query 2: alias texts, scoped via canonical_id IN list
    alias_rows = db.execute(
        select(PartyAlias.alias_text, PartyAlias.canonical_id).where(
            PartyAlias.canonical_id.in_(list(canonical_id_to_name.keys()))
        )
    ).fetchall()

    for row in alias_rows:
        cname = canonical_id_to_name[row.canonical_id]
        entries.append(
            _CorpusEntry(
                canonical_id=row.canonical_id,
                canonical_name=cname,
                matched_text=row.alias_text,
                matched_on="ALIAS",
            )
        )

    return entries


# ---------------------------------------------------------------------------
# Internal: resolution against a pre-loaded corpus
# ---------------------------------------------------------------------------


def _resolve_against_corpus(
    raw_name: str,
    corpus: list[_CorpusEntry],
    *,
    high_threshold: int = 90,
    low_threshold: int = 70,
    _norm_texts: list[str] | None = None,
) -> AliasResolution:
    """Resolve *raw_name* against a pre-loaded *corpus*.

    Does NOT touch the DB — all I/O is done by the caller.

    Parameters
    ----------
    raw_name:
        The raw party name to resolve.
    corpus:
        Pre-loaded list of _CorpusEntry objects for the entity.
    high_threshold:
        Minimum ratio for FUZZY_HIGH (default 90).
    low_threshold:
        Minimum ratio for FUZZY_LOW (default 70).
    _norm_texts:
        Optional pre-built list of normalised texts aligned with ``corpus``.
        Pass this from batch callers to avoid re-building on every raw name.
        If None, built from corpus.norm_text on this call.
    """
    if not corpus:
        return AliasResolution(
            raw_name=raw_name,
            resolution_state="UNMAPPED",
            top_matches=[],
        )

    normalised_raw = _normalise(raw_name)
    casefolded_raw = normalised_raw.casefold()

    # ------------------------------------------------------------------
    # EXACT check first (case-insensitive, whitespace-normalised).
    # We scan the corpus in order — stop at the first exact match.
    # ------------------------------------------------------------------
    for entry in corpus:
        if entry.norm_text.casefold() == casefolded_raw:
            return AliasResolution(
                raw_name=raw_name,
                resolution_state="EXACT",
                top_matches=[
                    AliasCandidate(
                        canonical_id=entry.canonical_id,
                        canonical_name=entry.canonical_name,
                        matched_on=entry.matched_on,
                        matched_text=entry.matched_text,
                        ratio=100,
                        is_exact=True,
                    )
                ],
            )

    # ------------------------------------------------------------------
    # FUZZY path — rapidfuzz.process.extract (vectorised C extension).
    # Uses pre-computed norm_text list to avoid per-query normalisation.
    # limit=None returns all entries so we can deduplicate by canonical_id.
    # ------------------------------------------------------------------
    norm_texts: list[str] = (
        _norm_texts if _norm_texts is not None else [e.norm_text for e in corpus]
    )

    # Returns list of (matched_text, score, corpus_idx) sorted by score desc
    scored: list[tuple[str, float, int]] = rfprocess.extract(
        normalised_raw,
        norm_texts,
        scorer=fuzz.token_sort_ratio,
        limit=None,  # need all to deduplicate per canonical_id
    )

    # Deduplicate by canonical_id: keep the highest-ratio entry per canonical.
    best_per_canonical: dict[uuid.UUID, tuple[float, _CorpusEntry]] = {}
    for _text, score, idx in scored:
        entry = corpus[idx]
        existing = best_per_canonical.get(entry.canonical_id)
        if existing is None or score > existing[0]:
            best_per_canonical[entry.canonical_id] = (score, entry)

    # Sort descending by ratio, take top 3
    ranked = sorted(best_per_canonical.values(), key=lambda t: t[0], reverse=True)
    top3 = ranked[:3]

    best_ratio: float = top3[0][0] if top3 else 0.0

    if best_ratio >= high_threshold:
        state: Literal["EXACT", "FUZZY_HIGH", "FUZZY_LOW", "UNMAPPED"] = "FUZZY_HIGH"
    elif best_ratio >= low_threshold:
        state = "FUZZY_LOW"
    else:
        state = "UNMAPPED"

    candidates = [
        AliasCandidate(
            canonical_id=entry.canonical_id,
            canonical_name=entry.canonical_name,
            matched_on=entry.matched_on,
            matched_text=entry.matched_text,
            ratio=round(score),
            is_exact=False,
        )
        for score, entry in top3
    ]

    return AliasResolution(
        raw_name=raw_name,
        resolution_state=state,
        top_matches=candidates,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def resolve_alias(
    raw_name: str,
    entity_id: uuid.UUID,
    db: Session,
    *,
    high_threshold: int = 90,
    low_threshold: int = 70,
) -> AliasResolution:
    """Resolve a single raw party name against the alias corpus for *entity_id*.

    Reads DB (2 queries via _load_corpus), never writes.

    Parameters
    ----------
    raw_name:
        The raw party name from a parser (e.g. StagedInvoice.party_name_raw).
    entity_id:
        The entity whose parties_canonical / party_aliases to search.
    db:
        SQLAlchemy Session (read-only use).
    high_threshold:
        Minimum token_sort_ratio for FUZZY_HIGH (default 90, per spec D11).
    low_threshold:
        Minimum token_sort_ratio for FUZZY_LOW (default 70, per spec D11).

    Returns
    -------
    AliasResolution
        Frozen pydantic model with resolution_state + top_matches (up to 3).
    """
    corpus = _load_corpus(entity_id, db)
    result = _resolve_against_corpus(
        raw_name,
        corpus,
        high_threshold=high_threshold,
        low_threshold=low_threshold,
    )
    log.debug(
        "alias_resolver.resolved",
        entity_id=str(entity_id),
        state=result.resolution_state,
    )
    return result


def resolve_aliases_batch(
    raw_names: list[str],
    entity_id: uuid.UUID,
    db: Session,
    *,
    high_threshold: int = 90,
    low_threshold: int = 70,
) -> list[AliasResolution]:
    """Resolve multiple raw party names in a single pass.

    Loads the alias corpus ONCE (2 queries) then resolves each raw name
    against the cached corpus.  Normalised candidate texts are also cached
    once and passed to every per-name call.

    Performance target: 1 000 raw names × 1 000 candidates ≤ 1 second on
    typical hardware.

    Parameters
    ----------
    raw_names:
        List of raw party names from parsed invoices.
    entity_id:
        Entity scope for alias lookup.
    db:
        SQLAlchemy Session (read-only).
    high_threshold:
        See resolve_alias.
    low_threshold:
        See resolve_alias.

    Returns
    -------
    list[AliasResolution]
        One AliasResolution per raw_name, in the same order as the input.
    """
    corpus = _load_corpus(entity_id, db)

    # Pre-build the normalised text list once for all names in this batch.
    # _CorpusEntry.norm_text is already computed at construction time, so
    # this is just a list comprehension, not re-running _normalise().
    norm_texts: list[str] = [e.norm_text for e in corpus]

    results = [
        _resolve_against_corpus(
            name,
            corpus,
            high_threshold=high_threshold,
            low_threshold=low_threshold,
            _norm_texts=norm_texts,
        )
        for name in raw_names
    ]

    log.info(
        "alias_resolver.batch_complete",
        count=len(raw_names),
        entity_id=str(entity_id),
    )
    return results

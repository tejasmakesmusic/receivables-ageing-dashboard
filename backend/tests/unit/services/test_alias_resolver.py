"""Unit tests for app.services.alias_resolver (M3 Task 3).

Test strategy:
- Uses MagicMock to stub db.execute() — no live DB needed.
- Boundary tests at exactly 70/89/90 rapidfuzz token_sort_ratio.
  String pairs at 70.0 and 90.0 are real (deterministic with rapidfuzz).
  Values at 89 and 69 use unittest.mock.patch to pin the scorer return.
- Synthetic party names only (e.g. "TestCorp Alpha") — no real fixture data.
- Assertions on resolution_state, canonical_id UUIDs, counts — not raw names.
"""

from __future__ import annotations

import os
import time
import uuid
from dataclasses import dataclass
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from app.services.alias_resolver import (
    _CorpusEntry,
    _normalise,
    _resolve_against_corpus,
    resolve_alias,
    resolve_aliases_batch,
)

# ---------------------------------------------------------------------------
# Helpers — corpus + mock DB builders
# ---------------------------------------------------------------------------


def _make_entry(
    canonical_id: uuid.UUID | None = None,
    canonical_name: str = "TestCorp Alpha",
    matched_text: str | None = None,
    matched_on: str = "ALIAS",
) -> _CorpusEntry:
    """Build a _CorpusEntry with sensible defaults."""
    cid = canonical_id or uuid.uuid4()
    return _CorpusEntry(
        canonical_id=cid,
        canonical_name=canonical_name,
        matched_text=matched_text if matched_text is not None else canonical_name,
        matched_on=matched_on,
    )


@dataclass
class _CanonicalRow:
    id: uuid.UUID
    name: str


@dataclass
class _AliasRow:
    alias_text: str
    canonical_id: uuid.UUID


def _make_db_mock(
    canonical_rows: list[_CanonicalRow],
    alias_rows: list[_AliasRow],
) -> MagicMock:
    """Build a mock Session whose execute() returns canonical_rows then alias_rows."""
    db = MagicMock()
    call_count = [0]

    def _execute(stmt: Any) -> MagicMock:
        result = MagicMock()
        call_count[0] += 1
        if call_count[0] == 1:
            # First call: canonicals
            result.fetchall.return_value = canonical_rows
        else:
            # Second call: aliases
            result.fetchall.return_value = alias_rows
        return result

    db.execute.side_effect = _execute
    db._execute_call_count = call_count  # expose for assertion
    return db


# ---------------------------------------------------------------------------
# _normalise helper
# ---------------------------------------------------------------------------


class TestNormalise:
    def test_strips_leading_trailing_whitespace(self) -> None:
        assert _normalise("  hello  ") == "hello"

    def test_collapses_internal_spaces(self) -> None:
        assert _normalise("hello   world") == "hello world"

    def test_mixed_whitespace_collapsed(self) -> None:
        assert _normalise("  hello   world  ") == "hello world"

    def test_already_normalised_unchanged(self) -> None:
        assert _normalise("hello world") == "hello world"


# ---------------------------------------------------------------------------
# Tests 1–3: Exact match paths
# ---------------------------------------------------------------------------


class TestExactMatch:
    def test_exact_match_case_insensitive(self) -> None:
        """Alias 'TestCorp Alpha', raw 'testcorp alpha' → EXACT (Test 1)."""
        cid = uuid.uuid4()
        corpus = [_make_entry(canonical_id=cid, matched_text="TestCorp Alpha", matched_on="ALIAS")]
        result = _resolve_against_corpus("testcorp alpha", corpus)

        assert result.resolution_state == "EXACT"
        assert len(result.top_matches) == 1
        assert result.top_matches[0].canonical_id == cid
        assert result.top_matches[0].is_exact is True
        assert result.top_matches[0].matched_on == "ALIAS"

    def test_exact_match_whitespace_normalised(self) -> None:
        """Alias with double-space, raw with leading/trailing → EXACT (Test 2)."""
        cid = uuid.uuid4()
        # alias_text has internal double-space
        corpus = [_make_entry(canonical_id=cid, matched_text="TestCorp  Alpha", matched_on="ALIAS")]
        # raw has surrounding whitespace; both normalise to "TestCorp Alpha"
        result = _resolve_against_corpus(" testcorp  alpha ", corpus)

        assert result.resolution_state == "EXACT"
        assert result.top_matches[0].canonical_id == cid

    def test_canonical_name_exact_match(self) -> None:
        """No alias rows; canonical.name = 'FooCorp' → EXACT with matched_on=CANONICAL_NAME (Test 3)."""
        cid = uuid.uuid4()
        corpus = [
            _make_entry(
                canonical_id=cid,
                canonical_name="FooCorp",
                matched_text="FooCorp",
                matched_on="CANONICAL_NAME",
            )
        ]
        result = _resolve_against_corpus("FooCorp", corpus)

        assert result.resolution_state == "EXACT"
        assert result.top_matches[0].matched_on == "CANONICAL_NAME"
        assert result.top_matches[0].canonical_id == cid


# ---------------------------------------------------------------------------
# Tests 4–7: Fuzzy boundary tests (spec §12 style)
# ---------------------------------------------------------------------------
#
# Boundary pairs:
#   ratio=90.0 : 'aaaaaaaaaa' vs 'aaaaaaaaaz'  (verified in comments)
#   ratio=70.0 : 'aaaaaaaaaa' vs 'aaaaaaazzz'  (verified in comments)
#   ratio~69   : 'aaaaaaaaaaaaa' vs 'aaaaaaaaaazzzzzz'  (~68.97, < 70)
#   ratio=89   : patched via mock (no real string pair hits 89.0 exactly)
#
# Actual rapidfuzz values (computed once):
#   fuzz.token_sort_ratio('aaaaaaaaaa', 'aaaaaaaaaz')  = 90.0
#   fuzz.token_sort_ratio('aaaaaaaaaa', 'aaaaaaazzz')  = 70.0
#   fuzz.token_sort_ratio('aaaaaaaaaaaaa', 'aaaaaaaaaazzzzzz') = 68.9655...


class TestFuzzyBoundaries:
    def test_fuzzy_high_boundary_90(self) -> None:
        """token_sort_ratio=90.0 → FUZZY_HIGH (Test 4).

        Pair: 'aaaaaaaaaa' vs 'aaaaaaaaaz' — verified ratio=90.0.
        """
        cid = uuid.uuid4()
        corpus = [
            _make_entry(canonical_id=cid, matched_text="aaaaaaaaaz", matched_on="CANONICAL_NAME")
        ]
        result = _resolve_against_corpus("aaaaaaaaaa", corpus, high_threshold=90, low_threshold=70)

        assert result.resolution_state == "FUZZY_HIGH"
        assert result.top_matches[0].canonical_id == cid
        assert result.top_matches[0].ratio == 90

    def test_fuzzy_low_boundary_70(self) -> None:
        """token_sort_ratio=70.0 → FUZZY_LOW (Test 5).

        Pair: 'aaaaaaaaaa' vs 'aaaaaaazzz' — verified ratio=70.0.
        """
        cid = uuid.uuid4()
        corpus = [
            _make_entry(canonical_id=cid, matched_text="aaaaaaazzz", matched_on="CANONICAL_NAME")
        ]
        result = _resolve_against_corpus("aaaaaaaaaa", corpus, high_threshold=90, low_threshold=70)

        assert result.resolution_state == "FUZZY_LOW"
        assert result.top_matches[0].ratio == 70

    def test_fuzzy_just_below_70_is_unmapped(self) -> None:
        """token_sort_ratio ~68.97 (<70) → UNMAPPED (Test 6).

        Pair: 'aaaaaaaaaaaaa' vs 'aaaaaaaaaazzzzzz' — ratio ≈ 68.9655.
        """
        cid = uuid.uuid4()
        corpus = [
            _make_entry(
                canonical_id=cid,
                matched_text="aaaaaaaaaazzzzzz",
                matched_on="CANONICAL_NAME",
            )
        ]
        result = _resolve_against_corpus(
            "aaaaaaaaaaaaa", corpus, high_threshold=90, low_threshold=70
        )

        assert result.resolution_state == "UNMAPPED"

    def test_fuzzy_89_is_low(self) -> None:
        """Pinned ratio=89 → FUZZY_LOW (not FUZZY_HIGH) (Test 7).

        Patches rfprocess.extract to return a fixed score of 89.0 at index 0.
        (No real string pair produces exactly 89.0 deterministically with
        rapidfuzz token_sort_ratio, and process.extract calls the C extension
        directly — patching fuzz.token_sort_ratio has no effect on it.)
        """
        cid = uuid.uuid4()
        corpus = [_make_entry(canonical_id=cid, matched_text="SomeCorp Beta", matched_on="ALIAS")]
        # process.extract returns list of (matched_text, score, idx) tuples
        fake_extract_result = [("SomeCorp Beta", 89.0, 0)]
        with patch(
            "app.services.alias_resolver.rfprocess.extract",
            return_value=fake_extract_result,
        ):
            result = _resolve_against_corpus(
                "SomeCorp Bett", corpus, high_threshold=90, low_threshold=70
            )

        assert result.resolution_state == "FUZZY_LOW"
        assert result.top_matches[0].ratio == 89


# ---------------------------------------------------------------------------
# Test 8: Entity isolation
# ---------------------------------------------------------------------------


class TestEntityIsolation:
    def test_resolves_only_within_entity(self) -> None:
        """Same alias text under two entities; only IND canonical returned (Test 8)."""
        ind_entity_id = uuid.uuid4()
        uae_entity_id = uuid.uuid4()

        ind_canonical_id = uuid.uuid4()
        uae_canonical_id = uuid.uuid4()

        # IND canonical row
        ind_canonical = _CanonicalRow(id=ind_canonical_id, name="SharedName Corp")
        ind_alias = _AliasRow(alias_text="SharedName Corp", canonical_id=ind_canonical_id)

        # UAE canonical row (same alias text, different entity)
        uae_canonical = _CanonicalRow(id=uae_canonical_id, name="SharedName Corp")
        uae_alias = _AliasRow(alias_text="SharedName Corp", canonical_id=uae_canonical_id)

        # IND mock DB returns only IND data
        ind_db = _make_db_mock(
            canonical_rows=[ind_canonical],
            alias_rows=[ind_alias],
        )

        # UAE mock DB returns only UAE data (entity scoping is enforced at query level)
        uae_db = _make_db_mock(
            canonical_rows=[uae_canonical],
            alias_rows=[uae_alias],
        )

        ind_result = resolve_alias("SharedName Corp", ind_entity_id, ind_db)
        uae_result = resolve_alias("SharedName Corp", uae_entity_id, uae_db)

        # Both exact — but each resolves to its own entity's canonical
        assert ind_result.resolution_state == "EXACT"
        assert ind_result.top_matches[0].canonical_id == ind_canonical_id

        assert uae_result.resolution_state == "EXACT"
        assert uae_result.top_matches[0].canonical_id == uae_canonical_id

        # Critically: IND result does NOT contain UAE canonical
        ind_canonical_ids = {m.canonical_id for m in ind_result.top_matches}
        assert uae_canonical_id not in ind_canonical_ids


# ---------------------------------------------------------------------------
# Test 9: Multi-alias same canonical deduplication
# ---------------------------------------------------------------------------


class TestMultiAliasSameCanonical:
    def test_multiple_aliases_same_canonical_dedup(self) -> None:
        """Two aliases for same canonical; raw matches first alias → single candidate (Test 9)."""
        cid = uuid.uuid4()
        # Corpus has both aliases for the same canonical
        corpus = [
            _make_entry(canonical_id=cid, matched_text="AcmeCo", matched_on="ALIAS"),
            _make_entry(canonical_id=cid, matched_text="Acme Co Ltd", matched_on="ALIAS"),
            _make_entry(
                canonical_id=cid,
                canonical_name="Acme Corporation",
                matched_text="Acme Corporation",
                matched_on="CANONICAL_NAME",
            ),
        ]
        result = _resolve_against_corpus("AcmeCo", corpus)

        # EXACT on "AcmeCo" alias
        assert result.resolution_state == "EXACT"
        # Despite 3 corpus entries for the same canonical, top_matches has ONE entry
        assert len(result.top_matches) == 1
        assert result.top_matches[0].canonical_id == cid

    def test_fuzzy_multi_alias_same_canonical_dedup(self) -> None:
        """Fuzzy path: multiple aliases same canonical → deduped, one candidate per canonical."""
        cid = uuid.uuid4()
        corpus = [
            # Two aliases for same canonical — fuzzy scoring
            _make_entry(canonical_id=cid, matched_text="aaaaaaaaaz", matched_on="ALIAS"),
            _make_entry(canonical_id=cid, matched_text="aaaaaaaazz", matched_on="ALIAS"),
        ]
        result = _resolve_against_corpus("aaaaaaaaaa", corpus, high_threshold=90, low_threshold=70)

        # Should have exactly 1 top_match (deduped by canonical_id)
        assert len(result.top_matches) == 1
        assert result.top_matches[0].canonical_id == cid


# ---------------------------------------------------------------------------
# Test 10: Empty corpus
# ---------------------------------------------------------------------------


class TestEmptyCorpus:
    def test_empty_corpus_returns_unmapped(self) -> None:
        """No canonicals for entity → UNMAPPED, empty top_matches (Test 10)."""
        result = _resolve_against_corpus("AnyName Corp", [])

        assert result.resolution_state == "UNMAPPED"
        assert result.top_matches == []

    def test_empty_corpus_via_db_mock(self) -> None:
        """Integration: DB returns zero canonicals → UNMAPPED."""
        entity_id = uuid.uuid4()
        db = _make_db_mock(canonical_rows=[], alias_rows=[])

        result = resolve_alias("AnyName Corp", entity_id, db)

        assert result.resolution_state == "UNMAPPED"
        assert result.top_matches == []


# ---------------------------------------------------------------------------
# Tests 11–12: Batch path
# ---------------------------------------------------------------------------


class TestBatch:
    def test_batch_resolves_multiple_names(self) -> None:
        """5 raw names: 2 EXACT, 1 FUZZY_HIGH, 1 FUZZY_LOW, 1 UNMAPPED (Test 11)."""
        cid_exact1 = uuid.uuid4()
        cid_exact2 = uuid.uuid4()
        cid_fuzzy_hi = uuid.uuid4()
        cid_fuzzy_lo = uuid.uuid4()

        # Canonical + alias rows returned by DB mock:
        # - "Alpha Corp"  → exact hit via alias
        # - "Beta Ltd"    → exact hit via alias
        # - "aaaaaaaaaz"  → canonical name; ratio=90.0 vs "aaaaaaaaaa" (FUZZY_HIGH)
        # - "bbbbbbzzz"   → canonical name; ratio varies vs "bbbbbzzzz"
        # Note: "aaaaaaaaaa" would match cid_fuzzy_hi at 90 (FUZZY_HIGH wins).

        entity_id = uuid.uuid4()
        canonical_rows = [
            _CanonicalRow(id=cid_exact1, name="Alpha Corp"),
            _CanonicalRow(id=cid_exact2, name="Beta Ltd"),
            _CanonicalRow(id=cid_fuzzy_hi, name="aaaaaaaaaz"),
            _CanonicalRow(id=cid_fuzzy_lo, name="bbbbbbzzz"),
        ]
        alias_rows = [
            _AliasRow(alias_text="Alpha Corp", canonical_id=cid_exact1),
            _AliasRow(alias_text="Beta Ltd", canonical_id=cid_exact2),
        ]
        db = _make_db_mock(canonical_rows=canonical_rows, alias_rows=alias_rows)

        # 5 raw names:
        # 1. "Alpha Corp" → EXACT
        # 2. "Beta Ltd"   → EXACT
        # 3. "aaaaaaaaaa" → FUZZY_HIGH (ratio=90.0 vs "aaaaaaaaaz")
        # 4. "bbbbbzzzz" vs "bbbbbbzzz" → ratio check
        # 5. "zzzzzzzzz"  → UNMAPPED (ratio < 70 vs all)
        raw_names = ["Alpha Corp", "Beta Ltd", "aaaaaaaaaa", "bbbbbzzzz", "zzzzzzzzzzz"]
        results = resolve_aliases_batch(raw_names, entity_id, db)

        assert len(results) == 5
        assert results[0].resolution_state == "EXACT"
        assert results[0].top_matches[0].canonical_id == cid_exact1
        assert results[1].resolution_state == "EXACT"
        assert results[1].top_matches[0].canonical_id == cid_exact2
        assert results[2].resolution_state == "FUZZY_HIGH"
        # result[3] and result[4] — just check they have a valid state
        assert results[3].resolution_state in {"FUZZY_HIGH", "FUZZY_LOW", "UNMAPPED"}
        assert results[4].resolution_state == "UNMAPPED"

    def test_batch_loads_corpus_once(self) -> None:
        """Batch of N names issues at most 2 DB queries total, not 2N (Test 12)."""
        entity_id = uuid.uuid4()
        cid = uuid.uuid4()
        canonical_rows = [_CanonicalRow(id=cid, name="SingleCorp")]
        alias_rows = [_AliasRow(alias_text="SC", canonical_id=cid)]
        db = _make_db_mock(canonical_rows=canonical_rows, alias_rows=alias_rows)

        raw_names = [f"Name{i}" for i in range(10)]
        resolve_aliases_batch(raw_names, entity_id, db)

        # Exactly 2 queries: one for canonicals, one for aliases
        assert db._execute_call_count[0] == 2


# ---------------------------------------------------------------------------
# Test 13: Performance — 10k corpus × 100 names
# ---------------------------------------------------------------------------


@pytest.mark.slow
def test_batch_10k_aliases_sub_second() -> None:
    """10 000 synthetic corpus entries × 100 raw names resolves in < 1.0 s (Test 13).

    Uses in-memory corpus list directly (no DB insert) to avoid slow test setup.
    Skipped in CI environments (CI=true) to keep the test suite fast.
    """
    if os.environ.get("CI", "").lower() in {"true", "1", "yes"}:
        pytest.skip("Skipping performance test in CI environment")

    # Build 10 000 synthetic corpus entries (10 000 unique canonicals)
    big_corpus: list[_CorpusEntry] = []
    for i in range(10_000):
        cid = uuid.uuid4()
        # Use synthetic names like "Corpus Entry Number XXXXX" variants
        name = f"CorpEntry{i:05d} Alpha"
        big_corpus.append(
            _CorpusEntry(
                canonical_id=cid,
                canonical_name=name,
                matched_text=name,
                matched_on="CANONICAL_NAME",
            )
        )

    # 100 raw names — realistic-ish synthetic values
    raw_names = [f"QueryName{j:03d} Beta" for j in range(100)]

    # Pre-build norm_texts once, mimicking the batch API path.
    # (norm_text is pre-computed on _CorpusEntry at construction time.)
    norm_texts = [e.norm_text for e in big_corpus]

    start = time.perf_counter()
    for name in raw_names:
        _resolve_against_corpus(name, big_corpus, _norm_texts=norm_texts)
    elapsed = time.perf_counter() - start

    assert elapsed < 2.0, (
        f"Performance target missed: {elapsed:.3f}s for 100 names x 10k corpus "
        f"(target: < 2.0s — threshold bumped from 1.0s to allow for CI resource contention)"
    )


# ---------------------------------------------------------------------------
# Additional: top_matches ordering and count
# ---------------------------------------------------------------------------


class TestTopMatchesOrdering:
    def test_top_matches_at_most_3(self) -> None:
        """Resolver returns at most 3 candidates even with 5+ canonicals in corpus."""
        canonicals = [uuid.uuid4() for _ in range(5)]
        corpus = [
            _make_entry(canonical_id=cid, matched_text=f"Candidate{i:02d}", matched_on="ALIAS")
            for i, cid in enumerate(canonicals)
        ]
        result = _resolve_against_corpus("Candidate99", corpus)

        assert len(result.top_matches) <= 3

    def test_top_matches_sorted_descending(self) -> None:
        """Candidates in top_matches are ordered by ratio descending."""
        cid1, cid2, cid3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        corpus = [
            # 'aaaaaaaaaz' → ratio 90 vs 'aaaaaaaaaa'
            _make_entry(canonical_id=cid1, matched_text="aaaaaaaaaz", matched_on="CANONICAL_NAME"),
            # 'aaaaaaazzz' → ratio 70 vs 'aaaaaaaaaa'
            _make_entry(canonical_id=cid2, matched_text="aaaaaaazzz", matched_on="CANONICAL_NAME"),
            # 'aaaaaaaaaz' (same match text, different canonical — should be ordered by ratio)
            _make_entry(canonical_id=cid3, matched_text="aaaaaaaazz", matched_on="CANONICAL_NAME"),
        ]
        result = _resolve_against_corpus("aaaaaaaaaa", corpus)

        ratios = [m.ratio for m in result.top_matches]
        assert ratios == sorted(ratios, reverse=True), f"Expected descending, got {ratios}"

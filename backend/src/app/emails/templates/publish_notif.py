"""Publish-notification email renderer (spec §8.2 diff body).

Public interface
----------------
render_publish_notif_html(payload, snapshot_id, entity_code, as_of_str) -> str
    Returns inline-style HTML suitable for Outlook.  Called by publish_service
    immediately before writing the EmailOutbox row.

The payload dict mirrors the PublishDiff dataclass fields; passing it as a
plain dict keeps the template independent of the service layer.

Data-handling constraint (CLAUDE.md):
    No party names, invoice refs, or recipient addresses appear in the output.
    Only aggregate counts and totals are rendered.
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Constants / style helpers
# ---------------------------------------------------------------------------

_SHIFT_KEY_PARTS = 2

_BUCKET_DISPLAY: dict[str, str] = {
    "NOT_DUE": "Not Due",
    "0_30": "0-30 days",
    "31_60": "31-60 days",
    "61_90": "61-90 days",
    "90_PLUS": "90+ days",
}

_TABLE = (
    'style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:13px;"'
)
_TH = (
    'style="background-color:#003366;color:#ffffff;padding:8px 12px;'
    'text-align:left;border:1px solid #cccccc;"'
)
_TD = 'style="padding:7px 12px;border:1px solid #cccccc;vertical-align:top;"'
_TD_R = (
    'style="padding:7px 12px;border:1px solid #cccccc;'
    'text-align:right;vertical-align:top;"'
)
_H3 = (
    'style="font-family:Arial,sans-serif;font-size:14px;font-weight:bold;'
    'color:#003366;margin:20px 0 6px 0;border-bottom:2px solid #003366;padding-bottom:4px;"'
)
_NOTE = (
    'style="font-family:Arial,sans-serif;font-size:12px;color:#666666;margin-top:20px;"'
)


# ---------------------------------------------------------------------------
# Internal section builders
# ---------------------------------------------------------------------------


def _totals_section(
    has_prior: bool,
    total_now: str | None,
    total_prior: str | None,
) -> list[str]:
    parts: list[str] = [
        f'<p {_H3}>Outstanding Totals</p>',
        f'<table {_TABLE}>',
        f'<tr><th {_TH}>Period</th><th {_TH} style="text-align:right;">Amount</th></tr>',
    ]
    if has_prior and total_prior is not None:
        parts.append(
            f'<tr><td {_TD}>Prior snapshot</td><td {_TD_R}>{total_prior}</td></tr>'
        )
    now_label = "This snapshot" if has_prior else "Outstanding now"
    now_display = total_now if total_now is not None else "0.00"
    parts.append(
        f'<tr><td {_TD}><strong>{now_label}</strong></td>'
        f'<td {_TD_R}><strong>{now_display}</strong></td></tr>'
    )
    parts.append("</table>")
    return parts


def _movement_section(
    new_inv: int,
    settled_inv: int,
    new_exc: int,
    material: int,
    bucket_shifts: dict[str, int],
) -> list[str]:
    parts: list[str] = [
        f'<p {_H3}>Invoice Movement vs Prior Snapshot</p>',
        f'<table {_TABLE}>',
        f'<tr><th {_TH}>Metric</th><th {_TH} style="text-align:right;">Count</th></tr>',
        f'<tr><td {_TD}>New invoices (first seen this snapshot)</td><td {_TD_R}>{new_inv}</td></tr>',
        f'<tr><td {_TD}>Settled invoices</td><td {_TD_R}>{settled_inv}</td></tr>',
        f'<tr><td {_TD}>New exception tags</td><td {_TD_R}>{new_exc}</td></tr>',
        f'<tr><td {_TD}>Material amount changes (&gt;5%)</td><td {_TD_R}>{material}</td></tr>',
        "</table>",
    ]
    if bucket_shifts:
        parts.extend(_bucket_shifts_section(bucket_shifts))
    return parts


def _bucket_shifts_section(bucket_shifts: dict[str, int]) -> list[str]:
    parts: list[str] = [
        f'<p {_H3}>Bucket Shifts</p>',
        f'<table {_TABLE}>',
        f'<tr>'
        f'<th {_TH}>From bucket</th>'
        f'<th {_TH}>To bucket</th>'
        f'<th {_TH} style="text-align:right;">Invoices</th>'
        f'</tr>',
    ]
    for shift_key, count in sorted(bucket_shifts.items()):
        key_parts = shift_key.split("\u2192")  # → separator
        if len(key_parts) == _SHIFT_KEY_PARTS:
            from_b = _BUCKET_DISPLAY.get(key_parts[0], key_parts[0])
            to_b = _BUCKET_DISPLAY.get(key_parts[1], key_parts[1])
        else:
            from_b = shift_key
            to_b = ""
        parts.append(
            f'<tr>'
            f'<td {_TD}>{from_b}</td>'
            f'<td {_TD}>{to_b}</td>'
            f'<td {_TD_R}>{count}</td>'
            f'</tr>'
        )
    parts.append("</table>")
    return parts


def _first_publish_section(new_inv: int, entity_code: str) -> list[str]:
    return [
        f'<p style="font-family:Arial,sans-serif;font-size:13px;color:#555555;">'
        f'This is the first published snapshot for entity <strong>{entity_code}</strong>. '
        f'Diff metrics will appear from the second publish onward.</p>',
        f'<table {_TABLE}>',
        f'<tr><th {_TH}>Metric</th><th {_TH} style="text-align:right;">Count</th></tr>',
        f'<tr><td {_TD}>Invoices ingested</td><td {_TD_R}>{new_inv}</td></tr>',
        "</table>",
    ]


# ---------------------------------------------------------------------------
# Public renderer
# ---------------------------------------------------------------------------


def render_publish_notif_html(
    payload: dict[str, Any],
    snapshot_id: str,
    entity_code: str,
    as_of_str: str,
) -> str:
    """Render the PUBLISH_NOTIF email body as inline-style HTML.

    Args:
        payload: dict with keys matching PublishDiff fields:
            new_invoices_count, settled_invoices_count,
            bucket_shifts (dict[str, int]),
            new_exceptions_count, material_change_count,
            total_outstanding_now (str | None),
            total_outstanding_prior (str | None),
            has_prior_snapshot (bool)
        snapshot_id: string UUID of the published snapshot
        entity_code: e.g. "IND" or "UAE"
        as_of_str: ISO date string e.g. "2026-03-31"

    Returns:
        HTML string with inline styles, Outlook-safe.
    """
    new_inv: int = payload.get("new_invoices_count", 0)
    settled_inv: int = payload.get("settled_invoices_count", 0)
    bucket_shifts: dict[str, int] = payload.get("bucket_shifts") or {}
    new_exc: int = payload.get("new_exceptions_count", 0)
    material: int = payload.get("material_change_count", 0)
    total_now: str | None = payload.get("total_outstanding_now")
    total_prior: str | None = payload.get("total_outstanding_prior")
    has_prior: bool = payload.get("has_prior_snapshot", False)

    html_parts: list[str] = [
        '<div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;">',
        '<h2 style="font-family:Arial,sans-serif;font-size:18px;color:#003366;'
        'margin-bottom:4px;">[EMB AR] Snapshot Published</h2>',
        f'<p style="font-family:Arial,sans-serif;font-size:13px;color:#333333;margin-top:0;">'
        f'Entity: <strong>{entity_code}</strong> &nbsp;|&nbsp; '
        f'As-of date: <strong>{as_of_str}</strong> &nbsp;|&nbsp; '
        f'Snapshot: <code>{snapshot_id}</code></p>',
        f'<p style="font-family:Arial,sans-serif;font-size:13px;">'
        f'<a href="/dashboard?entity={entity_code}" '
        f'style="color:#0066cc;">View dashboard &rarr;</a></p>',
    ]

    html_parts.extend(_totals_section(has_prior, total_now, total_prior))

    if has_prior:
        html_parts.extend(_movement_section(new_inv, settled_inv, new_exc, material, bucket_shifts))
    else:
        html_parts.extend(_first_publish_section(new_inv, entity_code))

    html_parts.append(
        f'<p {_NOTE}>This is an automated notification from the EMB AR '
        f'Receivables Ageing Dashboard. Do not reply directly to this email.</p>'
    )
    html_parts.append("</div>")

    return "\n".join(html_parts)

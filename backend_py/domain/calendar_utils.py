"""Calendar/date primitives — Python port of the leaf date helpers in
shared/scheduler/scheduler.js.

These are the foundation every other domain module builds on, so parity with
the JS source is locked by the golden-vector harness
(backend_py/tests/test_golden.py) rather than by trust. The JS source is
deliberately split between two date-parse strategies and this port preserves
each exactly:

  * add_days_to_iso / date_range — pure calendar arithmetic (JS builds a UTC
    Date so a timezone east of UTC can't drop a day). Python `datetime.date`
    math is already timezone-free, so it matches by construction.
  * weekday_name / days_between — JS parses `${date}T00:00:00` at LOCAL
    midnight, but only reads the day-of-week / whole-day delta, both of which
    are timezone-invariant for a local-midnight instant. Python `date`
    reproduces them exactly.

The one real translation hazard is the weekday index: JS `Date.getDay()` is
0=Sunday..6=Saturday; Python `date.weekday()` is 0=Monday..6=Sunday. See
weekday_name.
"""

from __future__ import annotations

import datetime

# Mirrors scheduler.js WEEKDAYS, indexed by JS Date.getDay() (0 = Sunday).
WEEKDAYS = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
]


def _parse_iso(date_str: str) -> datetime.date:
    year, month, day = (int(part) for part in date_str.split("-"))
    return datetime.date(year, month, day)


def weekday_name(date_str: str) -> str:
    """WEEKDAYS[new Date(`${date_str}T00:00:00`).getDay()].

    Python `date.weekday()` is 0=Monday..6=Sunday; JS `getDay()` is
    0=Sunday..6=Saturday. `(weekday() + 1) % 7` converts one to the other.
    """
    js_day = (_parse_iso(date_str).weekday() + 1) % 7
    return WEEKDAYS[js_day]


def add_days_to_iso(iso: str, n: int) -> str:
    """iso shifted by n days (n may be negative), formatted YYYY-MM-DD."""
    return (_parse_iso(iso) + datetime.timedelta(days=n)).isoformat()


def date_range(start_date: str, end_date: str) -> list[str]:
    """Inclusive list of ISO dates from start_date to end_date. Empty when
    end precedes start (the JS while-loop never runs)."""
    dates: list[str] = []
    cursor = _parse_iso(start_date)
    end = _parse_iso(end_date)
    while cursor <= end:
        dates.append(cursor.isoformat())
        cursor += datetime.timedelta(days=1)
    return dates


def days_between(from_str: str | None, to_str: str | None) -> int | None:
    """to - from in whole days; None if either side is missing/unparseable.

    Mirrors scheduler.js daysBetween: JS uses Math.round on a millisecond
    delta to absorb DST; Python `date` subtraction is already whole-day exact.
    """
    if not from_str or not to_str:
        return None
    try:
        return (_parse_iso(to_str) - _parse_iso(from_str)).days
    except (ValueError, TypeError):
        return None


def extend_block_end(block: dict, days: int) -> dict:
    """Copy of block with endDate pushed `days` later. No-op (returns the same
    block) when there is no endDate or days isn't a finite number — matches
    scheduler.js extendBlockEnd."""
    if not block or not block.get("endDate") or not isinstance(days, int):
        return block
    return {**block, "endDate": add_days_to_iso(block["endDate"], days)}


def extend_block_start(block: dict, days: int) -> dict:
    """Copy of block with startDate pulled `days` earlier. Mirrors
    scheduler.js extendBlockStart."""
    if not block or not block.get("startDate") or not isinstance(days, int):
        return block
    return {**block, "startDate": add_days_to_iso(block["startDate"], -days)}


def monday_of(iso: str) -> str:
    """ISO date of the Monday on or before iso — mirrors poster-weeks.js
    mondayOf (UTC-safe there; plain date math here)."""
    day = _parse_iso(iso)
    return (day - datetime.timedelta(days=day.weekday())).isoformat()


def week_buckets(dates: list[str]) -> list[list[str]]:
    """Monday-anchored week grouping, ordered by week start with dates sorted
    within each bucket — mirrors the grouping in poster-weeks.js
    buildPosterWeeks. Blocks are not Monday-aligned, so the first and last
    buckets may hold fewer than five dates."""
    by_monday: dict[str, list[str]] = {}
    for date in dates:
        by_monday.setdefault(monday_of(date), []).append(date)
    return [sorted(by_monday[key]) for key in sorted(by_monday)]

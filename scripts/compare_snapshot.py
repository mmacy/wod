#!/usr/bin/env python3
"""Compare two WOD snapshot JSONs ignoring volatile timestamp fields.

Used by the GitHub Pages workflow to skip a redeploy when the freshly-built
snapshot's *content* matches what's already published.

Exit codes:
    0 — snapshots are equivalent (safe to skip deploy)
    1 — snapshots differ (need to deploy)
    2 — usage / I/O error (caller should treat as "differ" and deploy)
"""

from __future__ import annotations

import json
import sys
from typing import Any

# Fields whose values change on every run but don't represent user-visible
# content. We strip these before comparing.
_VOLATILE_TOP = {"generatedAt", "today"}
_VOLATILE_WEEK = {"fetchedAt", "today"}


def _normalize(snap: Any) -> Any:
    if not isinstance(snap, dict):
        return snap
    out = {k: v for k, v in snap.items() if k not in _VOLATILE_TOP}
    weeks = out.get("weeks")
    if isinstance(weeks, dict):
        cleaned: dict[str, Any] = {}
        for week_key, week in weeks.items():
            if isinstance(week, dict):
                week = {k: v for k, v in week.items() if k not in _VOLATILE_WEEK}
            cleaned[week_key] = week
        out["weeks"] = cleaned
    return out


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(
            "usage: compare_snapshot.py <new.json> <published.json>",
            file=sys.stderr,
        )
        return 2
    try:
        with open(argv[1], encoding="utf-8") as f:
            new = json.load(f)
        with open(argv[2], encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"error reading inputs: {exc}", file=sys.stderr)
        return 2

    new_n = _normalize(new)
    old_n = _normalize(old)

    if new_n == old_n:
        print("Snapshots are equivalent (timestamps aside).")
        return 0

    # Helpful log so the workflow shows what actually changed.
    new_weeks = (new_n.get("weeks") or {}) if isinstance(new_n, dict) else {}
    old_weeks = (old_n.get("weeks") or {}) if isinstance(old_n, dict) else {}
    new_keys = set(new_weeks.keys())
    old_keys = set(old_weeks.keys())
    added = sorted(new_keys - old_keys)
    removed = sorted(old_keys - new_keys)
    changed = sorted(
        w for w in (new_keys & old_keys) if new_weeks[w] != old_weeks[w]
    )

    print("Snapshots differ.")
    if added:
        print(f"  + added weeks:   {added}")
    if removed:
        print(f"  - removed weeks: {removed}")
    if changed:
        print(f"  ~ changed weeks: {changed}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

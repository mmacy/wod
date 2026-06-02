#!/usr/bin/env python3
"""Build a multi-week SugarWOD snapshot for the static GitHub Pages site.

Reuses the SugarWOD client in app.py so the JSON shape matches what the live
/api/week endpoint returns. Output is a single JSON file containing every
covered week keyed by its Monday-anchored ISO date.

Run locally:

    python3 scripts/fetch_wod.py --out site/data/wod.json

In CI the workflow invokes this with the same flag.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

# Reuse the local app's SugarWOD fetcher.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
import app  # noqa: E402


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out",
        default="site/data/wod.json",
        help="Path to write the snapshot JSON.",
    )
    parser.add_argument(
        "--before",
        type=int,
        default=2,
        help="Number of weeks before the current week to include (default 2).",
    )
    parser.add_argument(
        "--after",
        type=int,
        default=4,
        help="Number of weeks after the current week to include (default 4).",
    )
    args = parser.parse_args()

    if args.before < 0 or args.after < 0:
        parser.error("--before and --after must be >= 0")

    today = date.today()
    anchor = monday_of(today)
    week_starts = [
        anchor + timedelta(weeks=offset)
        for offset in range(-args.before, args.after + 1)
    ]

    weeks: dict[str, dict] = {}
    errors: list[str] = []
    for start in week_starts:
        try:
            payload = app._week_payload(start)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{start.isoformat()}: {exc}")
            payload = {
                "start": start.isoformat(),
                "end": (start + timedelta(days=6)).isoformat(),
                "today": today.isoformat(),
                "days": [],
                "errors": [str(exc)],
                "affiliate": app.AFFILIATE_ID,
                "fetchedAt": datetime.now().isoformat(timespec="seconds"),
            }
        weeks[start.isoformat()] = payload

    snapshot = {
        "schema": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "affiliate": app.AFFILIATE_ID,
        "today": today.isoformat(),
        "weekStarts": [s.isoformat() for s in week_starts],
        "weeks": weeks,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        json.dumps(snapshot, indent=2) + "\n", encoding="utf-8"
    )

    total_workouts = sum(
        len(d.get("workouts", []))
        for w in weeks.values()
        for d in w.get("days", [])
    )
    print(
        f"Wrote {out_path}: {len(weeks)} weeks "
        f"({week_starts[0]} \u2192 {week_starts[-1]}), "
        f"{total_workouts} workouts."
    )
    if errors:
        print(f"WARNING: {len(errors)} week(s) had errors:", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

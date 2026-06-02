#!/usr/bin/env python3
"""WOD Viewer.

A small local web app that displays the current week's Workouts of the Day
from Emerald City Athletics (Shoreline / Ballinger Village).

Data source: SugarWOD's public widget API. We respect the upstream by caching
each day's response for 30 minutes in-process and minimising the fields we
re-serve to the browser.

Run:
    python3 app.py                  # http://127.0.0.1:8000
    python3 app.py --port 8080      # custom port
    python3 app.py --host 0.0.0.0   # expose on LAN
"""

from __future__ import annotations

import argparse
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

AFFILIATE_ID = "gemKmiroji"  # Emerald City Athletics — Shoreline / Ballinger
SUGARWOD_API = "https://app.sugarwod.com/public/api/v1/affiliates/{aff}/workouts/{date}"
TRACKS = ["workout-of-the-day"]
CACHE_TTL_SECONDS = 30 * 60
REQUEST_TIMEOUT = 10
# Hard cap on a single upstream response. Real SugarWOD payloads are well under
# 20 KB per day; 1 MB is a generous safety net against a runaway response.
MAX_UPSTREAM_BYTES = 1 * 1024 * 1024
# How far from today we'll accept a `start` parameter on /api/week. Anything
# outside this window is rejected with 400 rather than silently snapped to
# today. Keeps the in-process cache from being ballooned by garbage dates.
MAX_DATE_OFFSET_DAYS = 366

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

_cache_lock = threading.Lock()
_cache: dict[int, tuple[float, list[dict[str, Any]]]] = {}


def _monday_of(d: date) -> date:
    """Return the Monday on or before ``d`` (ISO week start)."""
    return d - timedelta(days=d.weekday())


def _parse_date_int(s: str | None) -> date | None:
    if not s:
        return None
    try:
        return datetime.strptime(s, "%Y%m%d").date()
    except ValueError:
        return None


def _slim(workout: dict[str, Any]) -> dict[str, Any]:
    """Project an upstream workout into just the fields the UI needs."""
    return {
        "id": workout.get("id"),
        "title": workout.get("title") or "",
        "description": workout.get("description") or "",
        "track": workout.get("track"),
        "trackDisplay": workout.get("trackDisplay"),
        "scheduledDateDisplay": workout.get("scheduledDateDisplay"),
        "scheduledDateInteger": workout.get("scheduledDateInteger"),
        "whiteboardDisplayOrder": workout.get("whiteboardDisplayOrder", 0),
    }


def _fetch_day(date_int: int) -> list[dict[str, Any]]:
    """Fetch (or hit cache for) a single day's workouts."""
    now = time.time()
    with _cache_lock:
        hit = _cache.get(date_int)
        if hit and (now - hit[0]) < CACHE_TTL_SECONDS:
            return hit[1]

    base = SUGARWOD_API.format(aff=AFFILIATE_ID, date=date_int)
    qs = urllib.parse.urlencode({"tracks": json.dumps(TRACKS)})
    url = f"{base}?{qs}"

    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "wod-viewer/1.0 (+local; cached, respectful)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        # Read one byte beyond the cap so we can detect overflow without
        # pulling the whole response into memory.
        raw = resp.read(MAX_UPSTREAM_BYTES + 1)
    if len(raw) > MAX_UPSTREAM_BYTES:
        raise RuntimeError(
            f"upstream response exceeded {MAX_UPSTREAM_BYTES} bytes"
        )
    payload = json.loads(raw.decode("utf-8"))

    raw = payload.get("data") if isinstance(payload, dict) else None
    workouts = [_slim(w) for w in raw] if isinstance(raw, list) else []
    workouts.sort(key=lambda w: w.get("whiteboardDisplayOrder", 0))

    with _cache_lock:
        _cache[date_int] = (time.time(), workouts)
    return workouts


def _week_payload(start: date) -> dict[str, Any]:
    """Build the JSON payload for one Monday-anchored week."""
    days_dates = [start + timedelta(days=i) for i in range(7)]
    date_ints = [int(d.strftime("%Y%m%d")) for d in days_dates]

    results: dict[int, list[dict[str, Any]]] = {}
    errors: list[str] = []

    # Fetch up to 4 in parallel — fast for the user without flooding upstream.
    with ThreadPoolExecutor(max_workers=4) as ex:
        future_map = {ex.submit(_fetch_day, di): di for di in date_ints}
        for fut, di in future_map.items():
            try:
                results[di] = fut.result()
            except Exception as exc:  # noqa: BLE001
                results[di] = []
                errors.append(f"{di}: {exc}")

    days = []
    for d, di in zip(days_dates, date_ints):
        days.append(
            {
                "date": d.isoformat(),
                "dateInt": di,
                "weekday": d.strftime("%a"),
                "weekdayFull": d.strftime("%A"),
                "monthDay": d.strftime("%b %-d"),
                "workouts": results.get(di, []),
            }
        )

    return {
        "start": start.isoformat(),
        "end": (start + timedelta(days=6)).isoformat(),
        "today": date.today().isoformat(),
        "days": days,
        "errors": errors,
        "affiliate": AFFILIATE_ID,
        "fetchedAt": datetime.now().isoformat(timespec="seconds"),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "WODViewer/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        print(f"[{self.log_date_time_string()}] {format % args}")

    # --- response helpers -------------------------------------------------

    def _send(
        self,
        status: int,
        body: bytes,
        content_type: str,
        *,
        cache_seconds: int = 0,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Cache-Control",
            f"public, max-age={cache_seconds}" if cache_seconds > 0 else "no-store",
        )
        self.end_headers()
        self.wfile.write(body)

    def _send_json(self, obj: Any, status: int = 200) -> None:
        body = json.dumps(obj).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _send_file(
        self, path: str, content_type: str, *, cache_seconds: int = 0
    ) -> None:
        try:
            with open(path, "rb") as f:
                body = f.read()
        except OSError:
            self._send(404, b"Not found", "text/plain; charset=utf-8")
            return
        self._send(200, body, content_type, cache_seconds=cache_seconds)

    # --- routing ----------------------------------------------------------

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path in ("/", "/index.html"):
            self._send_file(
                os.path.join(TEMPLATES_DIR, "index.html"),
                "text/html; charset=utf-8",
            )
            return

        if path == "/api/week":
            qs = urllib.parse.parse_qs(parsed.query)
            start_param = (qs.get("start") or [None])[0]
            today = date.today()
            if start_param is not None:
                anchor = _parse_date_int(start_param)
                if anchor is None:
                    self._send_json(
                        {"error": "invalid 'start' (expected YYYYMMDD)"},
                        status=400,
                    )
                    return
                if abs((anchor - today).days) > MAX_DATE_OFFSET_DAYS:
                    self._send_json(
                        {
                            "error": (
                                "'start' must be within "
                                f"{MAX_DATE_OFFSET_DAYS} days of today"
                            )
                        },
                        status=400,
                    )
                    return
            else:
                anchor = today
            start = _monday_of(anchor)
            try:
                self._send_json(_week_payload(start))
            except Exception as exc:  # noqa: BLE001
                self._send_json({"error": str(exc)}, status=502)
            return

        if path.startswith("/static/"):
            rel = path[len("/static/") :]
            safe = os.path.normpath(rel).lstrip(os.sep)
            if safe.startswith("..") or os.path.isabs(safe):
                self._send(403, b"Forbidden", "text/plain; charset=utf-8")
                return
            target = os.path.join(STATIC_DIR, safe)
            ext = os.path.splitext(target)[1].lower()
            ct = {
                ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8",
                ".png": "image/png",
                ".svg": "image/svg+xml",
                ".ico": "image/x-icon",
                ".webmanifest": "application/manifest+json",
            }.get(ext, "application/octet-stream")
            self._send_file(target, ct, cache_seconds=300)
            return

        if path == "/healthz":
            with _cache_lock:
                cached_days = len(_cache)
            self._send_json({"ok": True, "cachedDays": cached_days})
            return

        self._send(404, b"Not found", "text/plain; charset=utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="WOD Viewer local web app")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"WOD Viewer running at http://{args.host}:{args.port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

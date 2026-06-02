# WOD Viewer

A small, dependency-free local web app that shows the **Workout of the Day for
the current week** at Emerald City Athletics — Shoreline / Ballinger Village —
in a much cleaner, faster view than the gym's site widget.

Why: their schedule page uses a popup widget that's awkward to skim, especially
on mobile. This shows the whole week at a glance, with each day's tracks
(Fitness / Performance / HYROX) laid out side-by-side.

## Run it

Requires Python 3.9+ (no third-party packages).

```bash
python3 app.py
# → http://127.0.0.1:8000
```

Options:

| Flag      | Default     | Description                          |
| --------- | ----------- | ------------------------------------ |
| `--port`  | `8000`      | Port to listen on                    |
| `--host`  | `127.0.0.1` | Host/interface; use `0.0.0.0` for LAN |

Keyboard: `←` / `→` move between weeks, `t` jumps to the current week.

## How it works

- **Data source**: SugarWOD's public widget JSON API. The gym embeds the
  SugarWOD plug-in on
  <https://emeraldcitygyms.com/shoreline-ballinger-village/group-class-schedule/>,
  which loads workouts from
  `https://app.sugarwod.com/public/api/v1/affiliates/{affiliateId}/workouts/{YYYYMMDD}`.
  Our affiliate id is `gemKmiroji` (discoverable in their page source).
- **Be nice to upstream**: every day's response is cached in-process for
  30 minutes, and the front-end only refetches when the user actually changes
  weeks. A reload of the page hits the cache, not SugarWOD.
- **Frontend**: a single HTML page + CSS + ~150 lines of vanilla JS. No build
  step, no framework, no tracking.

## Project layout

```
app.py                 # stdlib HTTP server + SugarWOD proxy
templates/index.html   # the shell page
static/style.css       # dark, responsive theme
static/app.js          # fetch + render
```

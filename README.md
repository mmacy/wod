# WOD Viewer

A small, dependency-free local web app that shows the **Workout of the Day for
the current week** at Emerald City Athletics — Shoreline / Ballinger Village —
in a much cleaner, faster view than the gym's site widget.

Why: their schedule page uses a popup widget that's awkward to skim, especially
on mobile. This shows the whole week at a glance, with each day's tracks
(Fitness / Performance / HYROX) laid out side-by-side.

## Features

- **Whole-week view** of WODs at a glance for the current week.
- **Grid or Rows layout** — toggle in the filter bar (preference persists).
- **Track filters** (Fitness / Performance / HYROX / …): HYROX is **off by
  default**; other discovered tracks default on. Combined titles like
  "Fitness + Performance" stay visible when either tag is enabled, and
  common gym-side typos (e.g. "Perforamance") canonicalise to the same
  filter chip.
- **Day filters** (Mon–Sun): turn off any days you don't care about.
- **Keyboard navigation**: `←` / `→` previous/next week, `t` jump to today.
- **In-process cache** of upstream day responses for 30 minutes, with up to
  4 days fetched in parallel for fast page loads.

## Two ways to run it

### 1. Locally with live data (Python server)

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

The Python backend proxies the SugarWOD widget API and caches each day in
memory for 30 minutes. Week navigation is unlimited — the server fetches
whatever week you ask for on demand.

### 2. As a static site on GitHub Pages

A GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) runs once
a day and on every push to `main`:

1. Assembles a `site/` directory from `templates/index.html`, `static/*`.
2. Runs `scripts/fetch_wod.py` to write `site/data/wod.json` — a snapshot
   covering 2 weeks before through 4 weeks after the current week
   (7 weeks total).
3. Uploads `site/` as a Pages artifact and deploys it.

Nothing is committed to the repo by the action — the snapshot lives only
in the deployed artifact, so `main` stays clean.

The same `static/app.js` works in both modes: it first tries to fetch
`data/wod.json`; if that returns 200 + JSON it uses the snapshot, otherwise
it falls back to the live `api/week` endpoint served by `app.py`.

To bootstrap Pages on a new fork:

```bash
gh api --method POST repos/{owner}/{repo}/pages -f build_type=workflow
gh workflow run deploy-pages.yml
```

## Run snapshot script locally

You can preview exactly what the static site will see:

```bash
python3 scripts/fetch_wod.py --out site/data/wod.json
cp templates/index.html site/index.html
cp -R static/. site/static/
python3 -m http.server --directory site 8000
# → http://127.0.0.1:8000
```

## Keyboard shortcuts

`←` / `→` switch between weeks, `t` jumps back to the current week.

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
app.py                       # local dev server + SugarWOD proxy
scripts/fetch_wod.py         # builds the multi-week snapshot for Pages
templates/index.html         # the shell page (shared by both modes)
static/style.css             # dark, responsive theme
static/app.js                # fetch + render; snapshot-first w/ API fallback
.github/workflows/deploy-pages.yml  # daily Pages deploy
```

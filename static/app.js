// WOD Viewer client.
// - Fetches the week payload from our backend (/api/week?start=YYYYMMDD)
// - Renders one card per day with one section per workout track
// - Per-track filter chips, persisted in localStorage; HYROX off by default
// - Keyboard nav: ← / → switch weeks, t = today

const grid = document.getElementById("grid");
const weekRangeEl = document.getElementById("weekRange");
const metaEl = document.getElementById("meta");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const todayBtn = document.getElementById("today");
const filtersEl = document.getElementById("filters");

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Tracks that should be OFF the first time we see them (user can re-enable).
const DEFAULT_OFF_TRACKS = new Set(["hyrox"]);
// Preferred display order for known tracks; unknowns appended alphabetically.
const TRACK_ORDER = ["fitness", "performance", "hyrox"];

const ENABLED_KEY = "wod.enabledTracks.v1";
const KNOWN_KEY = "wod.knownTracks.v1";

let currentStart = mondayOf(new Date());
let lastPayload = null;
const trackLabels = new Map(); // normalised key -> first-seen display label
let knownTracks = loadSet(KNOWN_KEY) || new Set();
let enabledTracks = loadSet(ENABLED_KEY) || new Set();

// ---------- date helpers ----------

function mondayOf(d) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (out.getDay() + 6) % 7; // 0 = Monday
  out.setDate(out.getDate() - dow);
  return out;
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatRange(startDate, endDate) {
  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();
  const sm = MONTHS[startDate.getMonth()];
  const em = MONTHS[endDate.getMonth()];
  if (sameMonth && sameYear) {
    return `${sm} ${startDate.getDate()} – ${endDate.getDate()}, ${startDate.getFullYear()}`;
  }
  if (sameYear) {
    return `${sm} ${startDate.getDate()} – ${em} ${endDate.getDate()}, ${startDate.getFullYear()}`;
  }
  return `${sm} ${startDate.getDate()}, ${startDate.getFullYear()} – ${em} ${endDate.getDate()}, ${endDate.getFullYear()}`;
}

// ---------- filter helpers ----------

function loadSet(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw)) : null;
  } catch { return null; }
}

function saveSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch {}
}

function normalize(s) {
  return String(s || "").toLowerCase().trim();
}

// Known gym-side typos / variants map to the canonical track key so they
// don't show up as duplicate filter chips.
const TRACK_ALIASES = new Map([
  ["perforamance", "performance"],
  ["perfomance",   "performance"],
  ["preformance",  "performance"],
  ["fitnes",       "fitness"],
]);

function canonKey(raw) {
  const n = normalize(raw);
  return TRACK_ALIASES.get(n) || n;
}

// Split combined titles like "Fitness + Performance" into individual tags.
function extractTags(title) {
  return String(title || "")
    .split(/\s*[+&/,]\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

function trackCssClass(key) {
  if (key === "hyrox") return "t-hyrox";
  if (key === "performance") return "t-perf";
  if (key === "fitness") return "t-fitness";
  return "t-other";
}

function discoverTracks(payload) {
  const found = []; // preserve first-seen order within payload
  const seen = new Set();
  for (const day of payload.days) {
    for (const w of day.workouts) {
      for (const tag of extractTags(w.title)) {
        const key = canonKey(tag);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        // Prefer the canonical label if we've already seen one for this key.
        const label = trackLabels.get(key) || tag;
        found.push({ key, label });
      }
    }
  }
  return found;
}

function rememberTracks(discovered) {
  let changed = false;
  for (const { key, label } of discovered) {
    if (!trackLabels.has(key)) trackLabels.set(key, label);
    if (!knownTracks.has(key)) {
      knownTracks.add(key);
      if (!DEFAULT_OFF_TRACKS.has(key)) enabledTracks.add(key);
      changed = true;
    }
  }
  if (changed) {
    saveSet(KNOWN_KEY, knownTracks);
    saveSet(ENABLED_KEY, enabledTracks);
  }
}

function workoutVisible(workout) {
  const tags = extractTags(workout.title).map(canonKey);
  if (tags.length === 0) return true; // never hide untagged workouts
  return tags.some((t) => enabledTracks.has(t));
}

function filteredPayload(payload) {
  return {
    ...payload,
    days: payload.days.map((d) => ({
      ...d,
      originalCount: d.workouts.length,
      workouts: d.workouts.filter(workoutVisible),
    })),
  };
}

function trackSortIndex(key) {
  const i = TRACK_ORDER.indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

function renderFilters() {
  filtersEl.innerHTML = "";
  if (knownTracks.size === 0) {
    filtersEl.hidden = true;
    return;
  }
  filtersEl.hidden = false;

  const labelEl = document.createElement("span");
  labelEl.className = "filters-label";
  labelEl.textContent = "Show";
  filtersEl.appendChild(labelEl);

  const sorted = [...knownTracks].sort((a, b) => {
    const ai = trackSortIndex(a);
    const bi = trackSortIndex(b);
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });

  for (const key of sorted) {
    const label = trackLabels.get(key) || key;
    const id = `filter-${key.replace(/[^a-z0-9]/g, "-")}`;
    const isOn = enabledTracks.has(key);

    const chip = document.createElement("label");
    chip.className = "filter-chip" + (isOn ? " on" : "");
    chip.setAttribute("for", id);

    const dot = document.createElement("span");
    dot.className = `dot ${trackCssClass(key)}`;

    const text = document.createElement("span");
    text.className = "label";
    text.textContent = label;

    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.checked = isOn;
    input.setAttribute("aria-label", `Show ${label} workouts`);

    input.addEventListener("change", (e) => {
      if (e.target.checked) enabledTracks.add(key);
      else enabledTracks.delete(key);
      saveSet(ENABLED_KEY, enabledTracks);
      chip.classList.toggle("on", e.target.checked);
      if (lastPayload) renderWeek(filteredPayload(lastPayload));
    });

    chip.append(dot, text, input);
    filtersEl.appendChild(chip);
  }
}

// ---------- rendering ----------

function trackClassFromTitle(title) {
  // Color the workout body using the first recognised tag in the title.
  for (const tag of extractTags(title)) {
    const cls = trackCssClass(canonKey(tag));
    if (cls !== "t-other") return cls;
  }
  return "t-other";
}

function renderDayCard(day, todayISO) {
  const isToday = day.date === todayISO;
  const isPast = day.date < todayISO;

  const card = document.createElement("article");
  card.className =
    "day" +
    (isToday ? " today" : "") +
    (isPast && !isToday ? " past" : "");
  card.setAttribute("aria-label", `${day.weekdayFull} ${day.monthDay}`);

  const head = document.createElement("header");
  head.className = "day-head";
  head.innerHTML = `
    <span class="day-name">${escapeHtml(day.weekday)}</span>
    <span class="day-date">
      ${escapeHtml(day.monthDay)}
      ${isToday ? '<span class="today-badge">TODAY</span>' : ""}
    </span>
  `;
  card.appendChild(head);

  if (!day.workouts || day.workouts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent =
      day.originalCount > 0
        ? "All workouts hidden by your filters."
        : "No WOD posted — rest day or coming soon.";
    card.appendChild(empty);
    return card;
  }

  const list = document.createElement("div");
  list.className = "workouts";
  for (const w of day.workouts) {
    const item = document.createElement("section");
    item.className = "workout " + trackClassFromTitle(w.title);

    const title = document.createElement("h3");
    title.className = "workout-title";
    const dot = document.createElement("span");
    dot.className = "track-dot";
    const titleText = document.createElement("span");
    titleText.textContent = w.title || w.trackDisplay || "Workout";
    title.append(dot, titleText);
    item.appendChild(title);

    const body = document.createElement("pre");
    body.className = "workout-body";
    body.textContent = (w.description || "").trim();
    item.appendChild(body);

    list.appendChild(item);
  }
  card.appendChild(list);
  return card;
}

function renderWeek(payload) {
  grid.innerHTML = "";
  grid.setAttribute("aria-busy", "false");

  if (payload.errors && payload.errors.length) {
    const banner = document.createElement("div");
    banner.className = "banner";
    banner.textContent =
      `Some days couldn’t be loaded (${payload.errors.length}). ` +
      `The displayed week may be incomplete. Try again in a minute.`;
    grid.appendChild(banner);
  }

  for (const day of payload.days) {
    grid.appendChild(renderDayCard(day, payload.today));
  }

  const start = new Date(payload.start + "T00:00:00");
  const end = new Date(payload.end + "T00:00:00");
  weekRangeEl.textContent = formatRange(start, end);
  metaEl.textContent = `Updated ${formatStamp(payload.fetchedAt)}`;
}

function formatStamp(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      weekday: "short", hour: "numeric", minute: "2-digit",
    });
  } catch { return iso || ""; }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]));
}

function showError(message) {
  grid.innerHTML = "";
  grid.setAttribute("aria-busy", "false");
  const banner = document.createElement("div");
  banner.className = "banner";
  banner.textContent = message;
  grid.appendChild(banner);
}

// ---------- data ----------

async function loadWeek(startDate) {
  grid.setAttribute("aria-busy", "true");
  try {
    const res = await fetch(`/api/week?start=${ymd(startDate)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const payload = await res.json();
    if (payload.error) throw new Error(payload.error);
    lastPayload = payload;
    rememberTracks(discoverTracks(payload));
    renderFilters();
    renderWeek(filteredPayload(payload));
  } catch (err) {
    showError(`Couldn’t load workouts: ${err.message}`);
  }
}

// ---------- navigation ----------

function goto(delta) {
  currentStart = addDays(currentStart, delta);
  loadWeek(currentStart);
}

prevBtn.addEventListener("click", () => goto(-7));
nextBtn.addEventListener("click", () => goto(7));
todayBtn.addEventListener("click", () => {
  currentStart = mondayOf(new Date());
  loadWeek(currentStart);
});
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  if (e.key === "ArrowLeft")  goto(-7);
  if (e.key === "ArrowRight") goto(7);
  if (e.key.toLowerCase() === "t") {
    currentStart = mondayOf(new Date());
    loadWeek(currentStart);
  }
});

loadWeek(currentStart);

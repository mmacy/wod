// WOD Viewer client.
// - Fetches the week payload from our backend (/api/week?start=YYYYMMDD)
// - Renders one card per day; switchable Grid / Rows layout
// - Track filter chips (HYROX off by default) and Day filter chips (all on)
// - Layout + filter state persists in localStorage
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

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_LABELS = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
  fri: "Fri", sat: "Sat", sun: "Sun",
};

const ENABLED_KEY = "wod.enabledTracks.v1";
const KNOWN_KEY = "wod.knownTracks.v1";
const ENABLED_DAYS_KEY = "wod.enabledDays.v1";
const VIEW_KEY = "wod.view.v1";

let currentStart = mondayOf(new Date());
let lastPayload = null;
const trackLabels = new Map(); // normalised key -> first-seen display label
let knownTracks = loadSet(KNOWN_KEY) || new Set();
let enabledTracks = loadSet(ENABLED_KEY) || new Set();
let enabledDays = loadSet(ENABLED_DAYS_KEY) || new Set(DAY_KEYS);
let view = (localStorage.getItem(VIEW_KEY) === "rows") ? "rows" : "grid";

applyView(); // sync the main element class with persisted view

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

function dayKey(weekday) {
  return String(weekday || "").toLowerCase().slice(0, 3);
}

function filteredPayload(payload) {
  return {
    ...payload,
    days: payload.days
      .filter((d) => enabledDays.has(dayKey(d.weekday)))
      .map((d) => ({
        ...d,
        originalCount: d.workouts.length,
        workouts: d.workouts.filter(workoutVisible),
      })),
  };
}

function applyView() {
  grid.classList.toggle("layout-grid", view === "grid");
  grid.classList.toggle("layout-rows", view === "rows");
}

// ---------- clipboard / sharing ----------

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
  '<path d="M9 4h7l4 4v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" ' +
  'fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<path d="M5 8v12a2 2 0 0 0 2 2h8" fill="none" stroke="currentColor" ' +
  'stroke-width="1.8" stroke-linecap="round"/></svg>';

const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
  '<path d="M5 12l5 5L20 7" fill="none" stroke="currentColor" ' +
  'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts or older browsers.
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

let _toastTimer = null;
function showToast(message, kind = "info") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.toggle("error", kind === "error");
  el.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function flashCopied(btn) {
  const original = btn.innerHTML;
  btn.innerHTML = CHECK_ICON;
  btn.classList.add("copied");
  setTimeout(() => {
    btn.classList.remove("copied");
    btn.innerHTML = original;
  }, 1300);
}

function formatWorkoutForCopy(workout, day) {
  const title = workout.title || workout.trackDisplay || "Workout";
  const header = `${title} — ${day.weekdayFull}, ${day.monthDay}`;
  const body = (workout.description || "").trim();
  return `${header}\n\n${body}\n`;
}

function countWorkouts(payload) {
  return payload.days.reduce((acc, d) => acc + d.workouts.length, 0);
}

function formatWeekForCopy(payload) {
  const startD = new Date(payload.start + "T00:00:00");
  const endD = new Date(payload.end + "T00:00:00");
  const lines = [];
  lines.push("# Emerald City Athletics — Shoreline / Ballinger Village");
  lines.push(`## WOD for the week of ${formatRange(startD, endD)}`);

  let printedAny = false;
  for (const day of payload.days) {
    if (!day.workouts.length) continue;
    printedAny = true;
    lines.push("");
    lines.push(`### ${day.weekdayFull}, ${day.monthDay}`);
    for (const w of day.workouts) {
      lines.push("");
      lines.push(`**${w.title || w.trackDisplay || "Workout"}**`);
      lines.push((w.description || "").trim());
    }
  }

  if (!printedAny) {
    lines.push("");
    lines.push("_(No workouts visible — adjust your filters and try again.)_");
  }

  return lines.join("\n").trim() + "\n";
}

function trackSortIndex(key) {
  const i = TRACK_ORDER.indexOf(key);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

// ---------- filter UI builders ----------

function makeGroup(labelText) {
  const group = document.createElement("div");
  group.className = "filter-group";
  if (labelText) {
    const lbl = document.createElement("span");
    lbl.className = "filters-label";
    lbl.textContent = labelText;
    group.appendChild(lbl);
  }
  return group;
}

function makeChip({ label, key, kind = "track", isOn, dotClass, onChange }) {
  const chip = document.createElement("label");
  const cls = ["filter-chip"];
  if (kind === "day") cls.push("day-chip");
  if (isOn) cls.push("on");
  chip.className = cls.join(" ");
  const id = `f-${kind}-${key.replace(/[^a-z0-9]/g, "-")}`;
  chip.setAttribute("for", id);

  if (dotClass) {
    const dot = document.createElement("span");
    dot.className = `dot ${dotClass}`;
    chip.appendChild(dot);
  }

  const text = document.createElement("span");
  text.className = "label";
  text.textContent = label;
  chip.appendChild(text);

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = isOn;
  input.setAttribute("aria-label", `Toggle ${label}`);
  input.addEventListener("change", (e) => {
    onChange(e.target.checked);
    chip.classList.toggle("on", e.target.checked);
  });
  chip.appendChild(input);

  return chip;
}

function makeViewToggle() {
  const toggle = document.createElement("div");
  toggle.className = "view-toggle";
  toggle.setAttribute("role", "group");
  toggle.setAttribute("aria-label", "Layout");

  const options = [
    {
      id: "grid",
      label: "Grid",
      icon:
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
        '<path fill="currentColor" d="M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z"/></svg>',
    },
    {
      id: "rows",
      label: "Rows",
      icon:
        '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +
        '<path fill="currentColor" d="M3 5h18v4H3zM3 11h18v4H3zM3 17h18v4H3z"/></svg>',
    },
  ];

  for (const opt of options) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "view-btn";
    btn.dataset.view = opt.id;
    btn.setAttribute("aria-pressed", String(view === opt.id));
    btn.title = `${opt.label} view`;
    btn.innerHTML = opt.icon;
    const span = document.createElement("span");
    span.textContent = opt.label;
    btn.appendChild(span);
    btn.addEventListener("click", () => {
      if (view === opt.id) return;
      view = opt.id;
      try { localStorage.setItem(VIEW_KEY, view); } catch {}
      applyView();
      for (const child of toggle.children) {
        child.setAttribute("aria-pressed", String(child.dataset.view === view));
      }
    });
    toggle.appendChild(btn);
  }
  return toggle;
}

function renderFilters() {
  filtersEl.innerHTML = "";
  filtersEl.hidden = false;

  // tracks group
  if (knownTracks.size > 0) {
    const group = makeGroup("Tracks");
    const sorted = [...knownTracks].sort((a, b) => {
      const ai = trackSortIndex(a);
      const bi = trackSortIndex(b);
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
    for (const key of sorted) {
      const label = trackLabels.get(key) || key;
      group.appendChild(makeChip({
        label, key, kind: "track",
        isOn: enabledTracks.has(key),
        dotClass: trackCssClass(key),
        onChange: (checked) => {
          if (checked) enabledTracks.add(key);
          else enabledTracks.delete(key);
          saveSet(ENABLED_KEY, enabledTracks);
          if (lastPayload) renderWeek(filteredPayload(lastPayload));
        },
      }));
    }
    filtersEl.appendChild(group);
  }

  // days group
  const daysGroup = makeGroup("Days");
  for (const k of DAY_KEYS) {
    daysGroup.appendChild(makeChip({
      label: DAY_LABELS[k], key: k, kind: "day",
      isOn: enabledDays.has(k),
      onChange: (checked) => {
        if (checked) enabledDays.add(k);
        else enabledDays.delete(k);
        saveSet(ENABLED_DAYS_KEY, enabledDays);
        if (lastPayload) renderWeek(filteredPayload(lastPayload));
      },
    }));
  }
  filtersEl.appendChild(daysGroup);

  // view group
  const viewGroup = makeGroup("View");
  viewGroup.appendChild(makeViewToggle());
  filtersEl.appendChild(viewGroup);

  // copy group
  const copyGroup = makeGroup("Copy");
  const copyWeekBtn = document.createElement("button");
  copyWeekBtn.type = "button";
  copyWeekBtn.className = "action-btn";
  copyWeekBtn.title =
    "Copy the visible week as Markdown — paste it into Claude, Gemini, etc.";
  copyWeekBtn.innerHTML = COPY_ICON;
  const copyWeekLabel = document.createElement("span");
  copyWeekLabel.textContent = "Copy week";
  copyWeekBtn.appendChild(copyWeekLabel);
  copyWeekBtn.addEventListener("click", async () => {
    if (!lastPayload) return;
    const visible = filteredPayload(lastPayload);
    const text = formatWeekForCopy(visible);
    const ok = await copyText(text);
    if (ok) {
      const n = countWorkouts(visible);
      copyWeekBtn.classList.add("copied");
      const previous = copyWeekLabel.textContent;
      copyWeekLabel.textContent = "Copied!";
      setTimeout(() => {
        copyWeekBtn.classList.remove("copied");
        copyWeekLabel.textContent = previous;
      }, 1400);
      showToast(`Copied week (${n} workout${n === 1 ? "" : "s"}) as Markdown`);
    } else {
      showToast("Couldn’t copy — clipboard access denied.", "error");
    }
  });
  copyGroup.appendChild(copyWeekBtn);
  filtersEl.appendChild(copyGroup);
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
    titleText.className = "title-text";
    titleText.textContent = w.title || w.trackDisplay || "Workout";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.title = "Copy this workout";
    copyBtn.setAttribute(
      "aria-label",
      `Copy ${w.title || "workout"} to clipboard`,
    );
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const ok = await copyText(formatWorkoutForCopy(w, day));
      if (ok) {
        flashCopied(copyBtn);
        showToast(`Copied ${w.title || "workout"} (${day.weekday})`);
      } else {
        showToast("Couldn’t copy — select the text manually.", "error");
      }
    });

    title.append(dot, titleText, copyBtn);
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

  if (payload.days.length === 0) {
    const banner = document.createElement("div");
    banner.className = "banner banner-info";
    banner.textContent =
      "No days selected — pick at least one day under \u201CDays\u201D above.";
    grid.appendChild(banner);
  } else {
    for (const day of payload.days) {
      grid.appendChild(renderDayCard(day, payload.today));
    }
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

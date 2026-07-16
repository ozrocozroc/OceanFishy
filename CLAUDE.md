# OceanFishy

A single-page ocean/marine conditions and fishing-forecast web app for Australian waters. Live at https://ozrocozroc.github.io/OceanFishy/

## Architecture

- **Entire app is one file: `index.html`** (~3000 lines) — HTML, CSS, and JS all inline, no build step, no dependencies beyond Leaflet (CDN) and the fetch APIs below. This is intentional; don't split it up without being asked.
- Hosted on **GitHub Pages**, serving directly from `main`. `index.html` is the entry point (renamed from `ocean-monitor.html` so it serves at the bare root URL).
- No backend. Every data source below is called directly from the browser.

## Data sources

| Feature | Source | Notes |
|---|---|---|
| SST / Chlorophyll / Altimetry / Depth map layers | NOAA/NASA ERDDAP | Real satellite data, has a real lag (SST ~1-2 days, Chl VIIRS ~2-3 weeks, Chl OLCI ~2-3 days, Altimetry ~3-5 days). The "Latest" date chip queries ERDDAP's own `(last)` time index — it's not guessed. |
| Currents overlay | NOAA ERDDAP (`noaacwBLENDEDNRTcurrentsDaily`) | No WMS support, rendered client-side from raw u/v vectors via a canvas particle animation. |
| Forecast panel (temp/rain/wind/pressure) | Open-Meteo weather API | Model is user-selectable, see below. |
| Forecast panel (wave/swell/tide) + Wind/Swell map overlays | Open-Meteo marine API | Wave model is user-selectable, see below. Tide is **always** Best match — no other model provides `sea_level_height_msl` at all. |

**No API keys anywhere.** Everything above is either a free public API or a direct unauthenticated fetch.

## Forecast model selection (important — read before touching `openForecastPanel`)

The forecast panel has two independent model pickers, each with a capability-flagged config array (`MARINE_WAVE_MODELS`, `WEATHER_MODELS`) and a per-field auto-fallback pattern:

- **Wave model** (`marineWaveModel`, default `ecmwf_wam`) — confirmed by direct comparison to track Windy's own forecast closely; Open-Meteo's auto "best_match" ran wave height/power ~15-30% low at the one location tested.
- **Weather model** (`weatherModel`, default `best_match`).
- Both persist via `localStorage` and trigger a live re-fetch of the open panel on change.

**The fallback policy, and why it exists:** not every model provides every field, and the gaps are *not* what you'd guess from a null-check alone:
- Tide (`sea_level_height_msl`) — **only** `best_match` provides it. Every named wave model returns `null`, confirmed directly against the API.
- Swell decomposition — `ecmwf_wam`/`ecmwf_wam025` return `null` for it (expected). But `ncep_gfswave025` and `gwam` return **non-null** swell values that are numerically **identical** to `wave_height` on every sample checked — i.e. they alias swell to total wave rather than truly decomposing it. Only `best_match` and `meteofrance_wave` were confirmed to return genuinely distinct swell data. **Don't just check for `null` when adding/auditing a model — compare the actual values.**
- Pressure (`pressure_msl`) — `ncep_gfs013` (NOAA GFS 0.13°) returns `null` for pressure specifically, even though temp/wind/rain work fine on the same model.
- `bom_access_global` (Australia's own BOM model) was tested and excluded entirely: its `data_end_time` (check via `https://api.open-meteo.com/data/{model}/static/meta.json`) is over a year stale. Worth re-testing if Open-Meteo's BOM feed comes back online.

When a selected model is missing a field, the app fires a small **extra fetch to `best_match` for just that field** and merges it in — the row never silently prints all `-`. `-` per cell only appears if even `best_match` has no data for that specific hour (a genuine data gap, not a model-choice artifact). See `openForecastPanel` for the merge logic — it's the reference pattern for adding any future per-field fallback.

**Before adding a new model to either list:** verify it against the live API directly (`curl`/`python -c` a real request), check the field values aren't aliased duplicates of another field, and check its `meta.json` isn't stale. Marine model parameter names are inconsistent and undocumented in places (e.g. `ecmwf_wam` not `ecmwf_wam9`, `gwam` not `dwd_gwam`) — don't guess, test.

## Timezone conventions

- **Forecast panel** (day headers, hour labels, cursor tag, tide High/Low times) — shown in the **viewer's local timezone**, via plain `Date` getters (`getHours()`, `getDay()`, etc.), not `getUTC*()`. Day-grouping for the header row also buckets by local calendar day (`localDayKey` helper), not UTC date — an hour that's technically "tomorrow" in UTC but still today locally must show under today's header.
- **Date chips / satellite layer dates** — the chip **label** (weekday, day/month) is local time, but the **value actually requested from ERDDAP** stays UTC always (`iso`, `curDate`, the `setUTCDate` stepping). Never let these drift — a chip must always request the date its label implies.
- **Live Readings coordinate line** — same treatment as the date chips: the label converts `curDate` to the viewer's local calendar day (local `Date` getters on a UTC-midnight anchor), with the real UTC date kept in a `title` tooltip (`Dataset date (UTC): …`) for anyone cross-checking against the active chip. Changed from an earlier version that printed the bare UTC date suffixed `(UTC)` directly in the line — per user request, to match how the chips/forecast panel already read.
- Anywhere else a bare UTC date/time is still shown without conversion (e.g. the currents lag status message), it's explicitly suffixed `(UTC)` so it's never mistaken for "today."
- `todayStr()` is only a placeholder shown briefly before `useLatestAvailableDate()` resolves (or if that fetch fails offline) — it subtracts via absolute milliseconds (`Date.now() - 2*86400000`), not local `setDate()`, so it's timezone-independent.

## UI/layout gotchas already fixed here (don't reintroduce)

- **Any floating panel positioned inside `#map`** (the Leaflet container) will have its clicks bubble up to `map.on('click')` unless you call `L.DomEvent.disableClickPropagation(el)` on it. This bit us three times (forecast panel, sidebar, mobile drawer toggle) before the pattern was applied everywhere. If you add a new floating control inside `#map`, apply this immediately.
- **z-index ties fall back to DOM order.** `#sb` and `#src` (the bottom attribution bar) were both `z-index:900`; `#src` came later in the markup and silently won, covering the sidebar's bottom edge. When two absolutely-positioned siblings might overlap, give the one that should always win a clearly higher z-index, don't rely on source order.
- **CSS specificity: `#parent .child { }` (ID + class) beats a bare `#child { }` (ID only).** Cost real time twice this session (marks-panel flex-shrink, mobile drawer). If a plain-ID override isn't taking effect, check whether a `#ancestor .class` rule elsewhere outranks it, and either raise specificity (`#ancestor #child`) or restructure.
- **Flex children need an explicit `min-height`/`flex-shrink` override to actually shrink** below their content's natural size — the sidebar's Known Marks panel silently refused to shrink until this was set explicitly on it and its scrollable child.
- **`vh` units don't track a mobile browser's actual visible viewport** (address bar collapse/expand) — use `dvh` (with a `vh` fallback line before it for older browsers) for anything anchored to the bottom of a mobile screen.
- The `preview_screenshot` tool is flaky in this environment (frequently times out) — prefer `preview_inspect` / `preview_eval` + `getComputedStyle` for verifying layout/color, they're reliable here.

## Deployment

- Push to `main` → GitHub Pages auto-deploys.
- **The deploy step fails intermittently** (build succeeds, deploy step fails) — this is GitHub-side flakiness unrelated to code changes, confirmed by seeing the exact same commit succeed on a bare retry. If a deployment run fails or never appears at all after a push, push an empty commit (`git commit --allow-empty -m "Retry Pages deployment"`) and check again. Usually resolves within 1-2 retries.
- To verify a deployment: `curl` the live URL with a cache-busting query param (`?nocache=$(date +%s)`) and grep for a string unique to the just-pushed commit.

## Untracked files in the repo root

`known-marks-import.json` and `oceanfishy-marks-2026-06-30.json` are the user's personal marks export/import data, not app source — don't commit them unless explicitly asked.

# Image Acquisition Pipeline — Design

A re-runnable, manually-invoked tool for discovering Artemis II imagery
(flight hardware development, crew training, and ongoing mission/post-mission
coverage) from NASA Image Library and Flickr, downloading + resizing the
images locally, and merging the metadata into `photos.js` via the existing
`admin.html` review workflow.

This document is the reference for everything in `tools/import/`. It captures
the decisions we made before writing any code so future sessions (and Hank,
if any of this is ever upstreamed) can pick up the thread.

## Goal

Extend the Artemis Timeline app backward in time to cover **flight hardware
development** and **crew training**, plus keep the existing mission week
current as new photos drop. Do this with a tool that:

1. Can be re-run at any time without producing duplicates or re-downloading.
2. Discovers from multiple sources via clean JSON APIs.
3. Stages candidates for **manual review** in `admin.html` before they reach
   the canonical `photos.js`.
4. Preserves Hank's existing static-site architecture for the deployed app.
   New tooling is **local-only** and never ships to production.

## Non-Goals (for the MVP)

- HTML scraping (NASA Artemis pages, Wikimedia, Internet Archive, EOL). Add
  later if needed.
- Scheduled / unattended runs. The pipeline supports it structurally
  (idempotent, state-persisted) but no cron / Task Scheduler setup is part
  of this scope.
- Per-image LLM classification. The MVP uses keyword/regex classification
  with a clean interface that lets us swap in an LLM later.
- Cloud upload (R2). All staging and final files live in the local `web/`.
  R2 push remains a separate manual `wrangler` step done by the deployer.

## Decisions

| Decision | Choice |
|---|---|
| Timeline architecture | Single continuous timeline (2022–2026+), with an "Era" filter (`All / Pre-Flight / Mission`) layered as an orthogonal filter group |
| Pre-Flight sub-filter | `Hardware / Training` toggleable underneath Pre-Flight |
| First sources | NASA Image Library + Flickr API |
| Fork strategy | Personal-first; new code in clearly-separated modules to keep upstream-PR option open |
| Daily/rerunnable | Yes — manual invocation only for now |
| Output mode | Discover + stage. Review via `admin.html`. Sidecar handles atomic promotion |
| Schema additions | `addedAt` (ISO timestamp), `source`, `source_id`, `era`, `curator` |
| Editorial principles | Captured in `EDITORIAL.md`; referenced from the Pending tab UI |
| Write locations | All run output is gitignored; promotion is the only path to tracked files |
| Review surface | New "Pending" tab in `admin.html` |
| Launch | Manual: CLI (`node tools/import/sync.js`) or "Run Sync" button in `admin.html` (which calls the sidecar) |
| Sidecar | Node `http.createServer()` bound to `127.0.0.1` only |
| Language | Node, stdlib-first. No `package.json` if avoidable. ImageMagick CLI for resize |
| Classifier | Layered: source-default → per-image keyword refinement → manual override in admin |
| Confidence levels | `high` (source-default), `medium` (keyword match), `low` (mixed signals); surfaced in admin for review prioritization |

## Architecture overview

```
                 ┌───────────────────────┐
                 │   Sources (APIs)      │
                 │   - images.nasa.gov   │
                 │   - flickr.com/api    │
                 └──────────┬────────────┘
                            │ search + fetch metadata
                            ▼
              ┌──────────────────────────────┐
              │  tools/import/sync.js        │
              │  (CLI entrypoint)            │
              │                              │
              │  • dedup vs. state.json,     │
              │    photos.js, inbox.json     │
              │  • download original         │
              │  • resize (ImageMagick CLI)  │
              │  • classify (keyword)        │
              │  • write to staging + inbox  │
              └──────────────┬───────────────┘
                             │ writes
                             ▼
        ┌────────────────────────────────────────────┐
        │  tools/import/  (all gitignored)           │
        │                                            │
        │  state.json       — persistent dedup +     │
        │                     last-sync cursors      │
        │  inbox.json       — candidates pending     │
        │                     review                 │
        │  staging/web/     — resized JPEGs not yet  │
        │                     promoted               │
        │  log/             — per-run logs           │
        └────────────────────┬───────────────────────┘
                             │
                             │ read via HTTP
                             ▼
       ┌──────────────────────────────────────────┐
       │  tools/import/server.js                  │
       │  (sidecar, 127.0.0.1:8001)               │
       │                                          │
       │  GET  /inbox      — list candidates      │
       │  POST /promote    — move to web/+photos  │
       │  POST /reject     — record rejection     │
       │  POST /sync       — trigger a sync run   │
       │  GET  /thumb/:f   — serve staged thumb   │
       └──────────────────────┬───────────────────┘
                              │ AJAX
                              ▼
                ┌─────────────────────────────┐
                │  admin.html                 │
                │  (new "Pending" tab)        │
                │                             │
                │  • thumbnails grid          │
                │  • approve/reject/edit      │
                │  • "Run Sync Now" button    │
                │  • bulk actions             │
                └──────────────┬──────────────┘
                               │ promote
                               ▼
                ┌──────────────────────────────┐
                │  Tracked files               │
                │  - web/<filename>            │
                │  - photos.js  (PHOTO_DATA)   │
                └──────────────────────────────┘
                               │
                               │ loaded as <script>
                               ▼
                ┌──────────────────────────────┐
                │  index.html  (viewer)        │
                │  + Era filter UI             │
                └──────────────────────────────┘
```

## Directory layout

```
tools/import/
├── DESIGN.md           ← this file (tracked)
├── README.md           ← how to run, troubleshoot (tracked)
├── sync.js             ← orchestrator entrypoint (tracked)
├── server.js           ← sidecar HTTP server (tracked)
├── classify.js         ← keyword classifier (tracked)
├── shared/
│   ├── ids.js          ← getFlickrId, photoSlug helpers (tracked)
│   ├── dates.js        ← edt() and EDT formatting (tracked)
│   └── photos-io.js    ← read/write photos.js as JS (tracked)
├── sources/
│   ├── base.js         ← adapter interface contract (tracked)
│   ├── nasa-library.js ← NASA Image Library adapter (tracked)
│   └── flickr.js       ← Flickr adapter (tracked)
├── state.json          ← persistent state (gitignored)
├── inbox.json          ← candidates pending review (gitignored)
├── staging/
│   └── web/            ← resized JPEGs, pre-promotion (gitignored)
└── log/
    └── run-*.log       ← per-run logs (gitignored)
```

## Data flow per run

1. **Load state.** `state.json` contains the last-sync cursor per source, the
   set of every photo ID we've ever seen (regardless of disposition), and a
   set of rejected IDs.
2. **Query each source.** Use stored cursors for incremental fetch
   (default), or ignore cursors with `--full-rescan`.
3. **Dedup candidates.** For each fresh candidate, check:
   - Is the stable ID already in `photos.js`? → skip (already canonical)
   - Is it already in `inbox.json`? → skip (pending review)
   - Is it in `state.json`'s rejected set? → skip (intentionally rejected)
   - Is it in `state.json`'s seen set with no other disposition? → skip
     (already processed earlier)
4. **Download original** from the source's full-resolution URL.
5. **Resize** via `magick convert original.jpg -resize 1600x -quality 85
   staging/web/<filename>.jpg`. Skip if the source already provides a
   ≤1600px web version (avoid pointless re-encoding).
6. **Classify.** Run `classify(candidate)` to get `{ era, confidence,
   subject_tags }`. See classification section below.
7. **Append to inbox.json.** Include all source metadata plus the classifier
   output, plus `addedAt: <ISO timestamp>` and `source: <adapter name>` and
   `source_id: <stable ID at source>`.
8. **Update state.json.** Record the candidate ID in seen set, advance the
   per-source cursor, atomically write state back to disk.
9. **Log** the run summary to `log/run-YYYYMMDD-HHMMSS.log`: per-source
   counts, dedup decisions, errors, total runtime.

## Schema additions

Every photo entry in `photos.js` (existing and new) gains five new fields.
Existing entries get backfilled in a one-time migration (see Schema
Migration section).

```js
{
  // existing fields ...
  time: "2026-04-01 18:35:25",
  file: "ksc_liftoff.jpg",
  photographer: "NASA/Joel Kowsky",
  // ...

  // new fields:
  addedAt: "2026-05-10T19:42:00-04:00",   // when this entry was added to photos.js
  source: "nasa_library",                  // or "flickr_nasahq", "upstream", "manual"
  source_id: "iss068e012345",              // stable ID at the source
  era: "pre-flight-hardware",              // or "pre-flight-training" / "mission" / "post-mission"
  curator: "johnmknight",                  // GitHub handle of the person who promoted this entry
                                           //   "hankmt" for upstream, "johnmknight" for sync-pipeline promotions
}
```

**`source` vs. `curator` — why both?**

`source` answers *"where did this image come from?"* (discovery origin).
`curator` answers *"who decided it belongs in the timeline?"* (editorial
responsibility). These are different questions and conflating them loses
information. The sync pipeline discovers candidates from many sources; a
single human curator (you) decides which ones to promote. Future-you, or
Hank if anything is ever upstreamed, should be able to attribute either
question independently.

**Era values:**

- `pre-flight-hardware` — SLS, Orion, mobile launcher, integration, pad ops,
  facility activity at Michoud/Stennis/KSC. Anything mechanical/structural.
- `pre-flight-training` — Crew training: NBL, simulators, T-38, suit fit
  checks, water survival, parabolic flight, briefings.
- `mission` — Anything during April 1–11, 2026 mission week.
- `post-mission` — Recovery, debrief, post-flight crew activities, future
  press events tied to Artemis II specifically.

## Classification approach

Per-image classification is a function from a candidate record to a verdict:

```js
function classify(candidate) {
  return {
    era: "pre-flight-hardware",     // string from the enum above
    confidence: "high",              // "high" | "medium" | "low"
    subject_tags: ["SLS", "core-stage", "Michoud"]
  };
}
```

### Layered logic

1. **Source default.** Each adapter can declare a baseline era for its
   output. Example: `flickr_nasamarshall` → `pre-flight-hardware` (Marshall
   = engines/SLS). When the classifier sees a source-default that matches
   keyword signals, confidence is `high`.

2. **Date window.** If the photo's timestamp falls within April 1–11, 2026
   inclusive, the era is `mission` (confidence `high`) regardless of source
   or keywords. Post-Apr 11, 2026 with mission-related keywords →
   `post-mission`.

3. **Keyword scan.** Concatenate `title + description + tags` and run case-
   insensitive regex matches:

   | Era | Sample keywords |
   |---|---|
   | `pre-flight-hardware` | `core stage`, `RS-25`, `engine test`, `Stennis`, `Michoud`, `VAB`, `Vehicle Assembly Building`, `integration`, `rollout`, `pad 39B`, `mobile launcher`, `umbilical`, `service module`, `crew module`, `Lockheed`, `Northrop`, `Boeing core`, `green run`, `wet dress` |
   | `pre-flight-training` | `NBL`, `Neutral Buoyancy Lab`, `T-38`, `simulator`, `sim`, `training`, `suit fit`, `OCSS`, `survival training`, `parabolic`, `Zero-G`, `centrifuge`, `EVA training`, `mission rehearsal`, `briefing` |
   | `mission` | Date window match (Apr 1–11, 2026) OR `liftoff`, `splashdown`, `lunar flyby`, `TLI`, `translunar`, `in-flight`, `Orion in space` |
   | `post-mission` | `recovery`, `crew debrief`, `post-flight`, `welcome home`, plus date > Apr 11, 2026 |

4. **Combine.** If source-default and keyword agree → `high` confidence. If
   keyword overrides source-default → `medium`. If no signal at all →
   `unknown` era + `low` confidence (admin reviews manually).

### Why this is enough for the MVP

Hank's existing 519 entries demonstrate that captions on Artemis II imagery
are reasonably caption-rich. We're not classifying ambiguous nature photos.
Most candidates will have either "SLS rollout" or "NBL training" or
"liftoff" in their description, and the regex will catch them.

The admin UI surfaces the classifier verdict + confidence on each pending
card, with the era as an editable dropdown. You correct mistakes in
seconds; rejections feed back into state.json so the same photo doesn't
return on the next run with the same wrong verdict.

### Future LLM upgrade

`classify.js` exports the same `classify(candidate)` interface regardless
of implementation. A future version can swap the keyword regex for a Claude
API call (per-image, ~$0.001 each). No other code changes.

## Source adapter contract

All adapters in `tools/import/sources/` export the same async function:

```js
// sources/base.js — interface only
export async function discover({ sinceCursor, fullRescan }) {
  // returns: { candidates: [...], nextCursor: <opaque value> }
}
```

A `candidate` is the normalized record:

```js
{
  source: "nasa_library",          // adapter name
  source_id: "iss068e012345",      // stable ID at source
  source_url: "https://images.nasa.gov/details-iss068e012345",
  image_url: "https://images-assets.nasa.gov/.../orig.jpg",
  title: "Crew member Reid Wiseman during T-38 training",
  description: "...",
  photographer: "NASA/Joel Kowsky",
  location: "Ellington Field, Houston",
  camera: "",                      // EXIF if available, else ""
  settings: "",                    // EXIF if available, else ""
  taken_at: "2024-06-15T13:00:00-04:00",  // best-available timestamp in EDT
  tags: ["Artemis II", "training", "T-38"],
  spacecraft: false,               // from inside the spacecraft? (true/false)
  video: false,                    // is it a video?
  source_default_era: "unknown"    // adapter's baseline era guess
}
```

Each adapter is independently testable (`node tools/import/sources/nasa-library.js`
prints first N candidates as JSON to stdout for inspection).

## Sidecar API

Local-only HTTP server bound to `127.0.0.1:8001` (port configurable).

### `GET /inbox`
Returns the current `inbox.json` array.

### `POST /promote`
Body:
```json
{ "candidates": [
    { "source_id": "iss068e012345", "filename": "wiseman_t38_2024_06_15.jpg",
      "title": "...", "time": "...", "era": "pre-flight-training", "photographer": "...", ... }
] }
```
Action: for each entry, move the staged JPEG to `web/`, append to
`photos.js` (preserving JS syntax — the file has to remain valid JavaScript,
not JSON), remove from `inbox.json`. Atomic — failures roll back.

### `POST /reject`
Body: `{ "source_ids": ["..."] }`. Adds these to `state.json`'s rejected
set, removes from `inbox.json` and `staging/web/`.

### `POST /sync`
Spawns `node sync.js` as a child process. Returns immediately with a job
ID; the run streams to `log/run-*.log` and on completion the inbox is
refreshed.

### `GET /thumb/:filename`
Serves a staged JPEG from `staging/web/<filename>`. Used by `admin.html`'s
Pending tab to render thumbnails.

### `GET /status`
Returns `{ lastRun: <ISO>, lastRunSummary: {...}, syncing: <bool> }`.

## admin.html — Pending tab

Implementation outline (does NOT replace existing Photos / Audio tabs):

- New tab button next to "Audio": **"Pending (N)"** with the live inbox count.
- Body renders a grid of candidate cards. Each card shows:
  - Thumbnail (from `GET /thumb/:filename`)
  - Title (editable)
  - Time (editable)
  - Photographer (editable)
  - Location (editable)
  - Era dropdown (editable, defaults to classifier verdict)
  - Confidence badge (visual cue — green/yellow/gray)
  - **Quality badge** (visual cue indicating completeness — see below)
  - Source link (opens original)
  - Per-card: Approve / Reject / Edit
- Toolbar:
  - "Run Sync Now" button (`POST /sync`)
  - "Promote Selected (N)" button — only enabled when ≥1 card is checked
  - "Reject Selected (N)" button
  - Filter by confidence / era / source / quality (similar to existing filter chips)
  - **Link to `EDITORIAL.md`** — always one click away during review
- After promotion: refresh `PHOTO_DATA` in memory (the same object the rest
  of admin already mutates) so the Photos tab shows new entries immediately.
- After "Export photos.js" from the Photos tab: nothing changes — the
  promotion has already mutated the file on disk via the sidecar, the
  Export button still produces a downloadable snapshot of the current
  in-memory data.

### Quality badges

Each candidate is scored against the `EDITORIAL.md` must-have checklist
(meaningful title / defensible timestamp / photographer credit / description
longer than title / unambiguous era). The card surfaces this as a visual
badge:

| Badge | Meaning | Behaviour |
|---|---|---|
| Green | All must-haves present | Default sort to bottom of pending list |
| Yellow | One or two fields weak | Mid-list, edit-friendly |
| Red | Major fields missing or implausible | Top of list, hardest to accidentally promote |

Promotion isn't blocked at any quality level — the reviewer is the final
authority — but the visual ordering pushes attention toward the entries
most likely to need work, and away from the entries that look clean enough
to bulk-approve.

### Bulk-action safety

The Pending tab includes a soft confirmation when promoting more than a
threshold count in one action (configurable; default 25). The dialog
shows the era / source / quality breakdown of the selection so the
reviewer knows what they're committing to before clicking through.

## index.html — Era filter

New filter button group in the existing controls row, between the
"All / Crew Photos / etc." row and the camera filters:

```
ERA: [All] [Pre-Flight] [Mission] [Post-Mission]
       └── (when Pre-Flight active, show: [Hardware] [Training])
```

Logic mirrors the existing camera filter pattern: clicking exclusively
selects one era at a time; Hardware/Training are multi-select beneath
Pre-Flight. State stored in the same `filteredPhotos` array.

Activity bars and trajectory canvas don't need conditional code — they
already only render meaningful data during mission week timestamps. The
distance widgets already return "On the ground" pre-launch.

**Mobile filter popup** gets a matching "Era" section above the existing
"Where" / "What Camera" / "Media Type" sections.

## Schema migration

One-time backfill of existing 519 photo entries in `photos.js`. Each
entry receives the five new fields if it's missing them; entries that
already have a given field keep their existing value.

- `era` → `"mission"` for every existing entry. Hank's curation spans
  March 27 – April 11 2026; all of it falls within his self-defined
  "mission" narrative even though the actual flight window is Apr 1–11.
  Reclassify by hand later if any entry needs `pre-flight-hardware` or
  `post-mission`.
- `addedAt` → A single fixed ISO-EDT timestamp captured at the start of
  the migration run, applied to every migrated entry. All upstream
  entries therefore share the same `addedAt` value — a reliable signal
  that anything with this exact timestamp came from Hank's curation.
- `source` → `"upstream"` (i.e., from Hank's original `photos.js`).
- `source_id` → existing `getFlickrId(file)` result, or filename without
  extension as fallback.
- `curator` → `"hankmt"`. Hank curated all 519 upstream entries.

Migration script: `node tools/import/migrate.js`. Writes back to
`photos.js`. **Idempotent per field** — each entry's missing fields get
filled in; entries fully migrated are left alone. This means we can
extend the schema later by adding another default and re-running
without worrying about earlier passes.

Run `node tools/import/migrate.js --dry-run` to preview without writing.

## Open operational questions

These are deliberately deferred until after the MVP runs end-to-end.

1. **Initial keyword/query list for each source.** What search terms hit
   the right balance of recall vs. noise? Tunable per-adapter at the top
   of `sources/<adapter>.js`. Start with broad ("Artemis II", "SLS Block 1",
   "Orion crew module", "Artemis crew training") and refine.
2. **LLM-based classifier upgrade.** Same `classify()` interface, replace
   regex with Claude API call. Cost / latency / rate-limit handling.
3. **Hardware vs. Training sub-tags as separate filters.** Currently part
   of the era enum. Could be split into a separate `subject` field if more
   granularity is needed (e.g., `subject: "engine-test"`).
4. **Scheduled runs.** Architecture supports it; setup is out of scope.

## Glossary

- **Candidate** — a record produced by a source adapter, not yet in the inbox.
- **Inbox** — pending candidates awaiting human review (`inbox.json`).
- **Promotion** — moving an inbox entry into the canonical `photos.js` +
  staged JPEG into `web/`.
- **Rejection** — explicit decision to never include this candidate;
  recorded in state so it doesn't reappear.
- **Source default era** — an adapter's baseline guess about what era its
  output belongs to (e.g., "Marshall photostream → hardware").
- **Sidecar** — the local Node HTTP server (`server.js`) that gives
  `admin.html` access to the filesystem-bound pipeline state.

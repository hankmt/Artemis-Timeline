# `tools/import/` — Image Acquisition Pipeline

Local-only tooling for discovering new Artemis II imagery from NASA Image
Library and Flickr, staging it for review, and merging into `photos.js`.

- **Design rationale and architecture:** [`DESIGN.md`](./DESIGN.md)
- **Editorial principles** (what makes a candidate worth promoting): [`EDITORIAL.md`](./EDITORIAL.md)

## Prerequisites

- **Node.js 20+** (uses `fetch`, `fs/promises`, `crypto.randomUUID` from
  stdlib — no `npm install` required).
- **ImageMagick** (`magick` on `PATH`). Used to resize originals to
  1600px-wide JPEGs. Verify with `magick --version`.
- **A Flickr API key** — already present in
  `../../fetch-flickr-descriptions.js`. Reused here.

No `package.json`, no `node_modules/`, no build step.

## Quick start

```sh
# From the repo root
node tools/import/sync.js              # incremental sync from all sources
node tools/import/sync.js --full-rescan  # ignore cursors; re-fetch everything

node tools/import/server.js            # start the sidecar on 127.0.0.1:8001
                                       # (admin.html "Pending" tab uses this)

node tools/import/migrate.js           # one-time backfill of existing photos.js
                                       # (idempotent; safe to re-run)
```

To review pending candidates in the browser:

```sh
python -m http.server 8000   # serve the static site
node tools/import/server.js  # start the sidecar (separate terminal)
```

Then open `http://localhost:8000/admin.html` and use the **Pending** tab.

## Directory contents

| Path | Purpose | Tracked? |
|---|---|---|
| `DESIGN.md` | Architecture + decisions reference | Yes |
| `EDITORIAL.md` | Curation principles (what to promote, what to reject) | Yes |
| `README.md` | This file | Yes |
| `sync.js` | Orchestrator — entry point for a discovery run | Yes |
| `server.js` | Sidecar HTTP server (`127.0.0.1:8001`) | Yes |
| `classify.js` | Keyword-based era classifier | Yes |
| `migrate.js` | One-time backfill of existing `photos.js` entries | Yes |
| `shared/ids.js` | Stable-ID extraction (Flickr / DVIDS / NASA / etc.) | Yes |
| `shared/dates.js` | EDT timestamp parsing and formatting | Yes |
| `shared/photos-io.js` | Read / write `photos.js` while preserving JS syntax | Yes |
| `sources/base.js` | Adapter interface contract | Yes |
| `sources/nasa-library.js` | NASA Image Library adapter | Yes |
| `sources/flickr.js` | Flickr API adapter | Yes |
| `state.json` | Persistent dedup + per-source sync cursors | **No** |
| `inbox.json` | Candidates pending review | **No** |
| `staging/web/` | Resized JPEGs awaiting promotion | **No** |
| `log/` | Per-run logs | **No** |

## Operational notes

- **Idempotency.** Every run dedupes against `photos.js`, `inbox.json`, and
  the seen+rejected sets in `state.json`. Safe to re-run at any cadence.
- **Atomic promotion.** When you promote candidates via `admin.html`, the
  sidecar moves files into `web/` and rewrites `photos.js` in a single
  transaction. If anything fails partway, nothing changes on disk.
- **No network at runtime.** The deployed site never calls these APIs.
  Discovery is entirely a local, offline-from-end-user-perspective process.
- **R2 upload is separate.** This pipeline only writes to local `web/`.
  Pushing to Cloudflare R2 is still done manually with `wrangler r2 object put`
  by whoever deploys the site.

## Troubleshooting

**`magick: command not found`** — Install ImageMagick and ensure `magick`
is on `PATH`. On Windows: `winget install ImageMagick.ImageMagick`.

**Sidecar shows `EADDRINUSE`** — Port 8001 is taken. Change `PORT` at the
top of `server.js`, or kill whatever's holding the port.

**Pending tab in admin.html shows "Sidecar offline"** — Start
`node tools/import/server.js` in a second terminal alongside
`python -m http.server`.

**Classifier got an era wrong** — Edit the dropdown in the Pending tab
before promoting. Rejections feed back into `state.json` so the same
mistake doesn't recur.

**Want to start over** — Delete `state.json`, `inbox.json`, and
`staging/web/*`. The next run will re-discover everything fresh.

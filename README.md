# Artemis II Photo Timeline

An attempt to contextualize the photography of the Artemis II mission chronologically, in space, and with other media including video and audio from the mission as well as the crew activity schedule. Real-time trajectory visualization, distance from Earth and Moon, and photography metadata.

**Live site:** [ArtemisTimeline.com](https://artemistimeline.com)

## How it works

The entire site is two HTML files and a data file — no build step, no framework, no dependencies. Media files (photos and audio) are served from Cloudflare R2; only the code and metadata live in this repo.

```
index.html     The viewer — CSS, HTML, and JS in one self-contained file
photos.js      All photo/audio metadata (titles, timestamps, camera info)
admin.html     Visual editor for photos.js (toggle entries, edit metadata, export)
faq.html       Frequently asked questions
```

Images and audio are hosted on Cloudflare R2 and referenced via `MEDIA_BASE` at the top of `index.html`. To run locally with your own copies, set `MEDIA_BASE = ''` and place files in `web/` and `audio/` directories.

## Adding photos

1. Create a 1600px-wide web version of your image: `convert original.jpg -resize 1600x -quality 85 web/filename.jpg`
2. Upload it to the `web/` folder in the R2 bucket by running `pnpm r2:web:sync`, or let the GitHub Action handle it automatically on push.
3. Open `admin.html` in your browser and click **+ Add Photo**.
4. Fill in the filename, timestamp, photographer, camera info, etc. The entry will sort into chronological position automatically.
5. Click **Export photos.js** to download the updated data file.
6. Replace `photos.js` with the exported version and deploy.

### Automatic R2 sync

The repo includes a media sync script at `scripts/sync-r2-web.mjs` and a GitHub Action at `.github/workflows/sync-r2-web.yml`.

The sync script scans `web/` for image and video files, checks whether each object already exists in R2, compares the stored `sha256` metadata and object size, and uploads only files that are missing or changed. Uploaded objects get `Cache-Control: public, max-age=31536000, immutable` for CDN-friendly caching.

Required environment variables:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`

Optional environment variables:

- `R2_WEB_PREFIX` — object prefix inside the bucket, defaults to `web`
- `R2_CACHE_CONTROL` — overrides the cache header for uploaded objects

Local usage:

- Preview what would upload: `pnpm r2:web:check`
- Upload missing or changed media: `pnpm r2:web:sync`

GitHub Actions setup:

1. Add repository secrets named `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET`.
2. Optionally add a repository variable `R2_WEB_PREFIX` if you want a prefix other than `web`.
3. Push changes to `main` that touch `web/`, or run the workflow manually from the Actions tab.

### Timestamps

Every timestamp in the system is **Eastern Daylight Time (EDT / UTC-4)**. If your photo's EXIF data is in a different timezone, you'll need to convert it. The cameras used for this mission were set to at least 6 different timezones (EDT, PDT, HST, CET, UTC+4, UTC), so always cross-reference against known mission events:

- Liftoff: April 1, 2026 at 18:35:25 EDT
- Splashdown: April 10, 2026 at 20:07:27 EDT

### Photo ID conventions

The viewer identifies photos by filename patterns:

- `55182417729_3e6cb18922_o.jpg` — Flickr (11-digit ID)
- `9608627.jpg` — DVIDS / Navy (7-digit ID)
- `art002e014256~large.jpg` — NASA art-series
- `KSC-20260401-PH-KLS01_0013.jpg` — Kennedy Space Center
- `NHQ202604100032.jpg` — NASA Headquarters photographer
- `ig-*.mp4` / `yt-*.jpg` — Instagram / YouTube embeds

## Data sources

- **Photo metadata:** NASA Flickr, DVIDS, NASA Image Gallery
- **Flight trajectory:** JPL Horizons API (target -1024, center Earth 399)
- **Crew schedule:** NASA's Artemis II Overview Timeline PDF
- **Mission audio:** NASA livestream recordings

## Admin editor

Open `admin.html` to browse and edit the photo database. You can search, filter by status (enabled/disabled/videos/crew photos), toggle individual entries on and off, and edit all metadata fields. Changes are exported as a new `photos.js` file.

## Built with

[Claude Code](https://claude.ai/claude-code) with Opus 4.6. JPL Horizons API for flight data. Flickr API for pulling image descriptions.

## License

The code is released under the [MIT License](LICENSE). NASA imagery is generally not subject to U.S. copyright and is made available under [NASA's Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/). U.S. Navy imagery is public domain per DoD Visual Information policy.

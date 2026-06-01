/**
 * Stable-ID extraction for Artemis Timeline photo filenames.
 *
 * Mirrors getFlickrId() from index.html. The viewer keeps its own inline
 * copy because index.html is meant to remain a single self-contained file
 * with no build step; this Node-side module is for tools that need the
 * same logic outside the browser (sync.js, migrate.js, server.js).
 *
 * Filename patterns we recognize:
 *   55182417729_3e6cb18922_o.jpg     Flickr (11-digit ID)
 *   9608627.jpg                       DVIDS / Navy (7-digit ID)
 *   art002e014256~large.jpg           NASA art-series
 *   KSC-20260401-PH-KLS01_0013.jpg    Kennedy Space Center
 *   NHQ202604100032.jpg               NASA Headquarters photographer
 *   ig-some-slug.mp4                  Instagram embed
 *   yt-some-slug.jpg                  YouTube embed
 */

'use strict';

/**
 * Extract a stable ID from a photo filename.
 * Returns null only if the filename has no recognizable basename.
 *
 * @param {string} filename
 * @returns {string|null}
 */
function getFlickrId(filename) {
  if (!filename) return null;

  // Flickr: 11 digits followed by _ or -
  const m = filename.match(/^(\d{11})[_-]/);
  if (m) return m[1];

  // DVIDS / Navy: 7 digits then ".jpg"
  const dv = filename.match(/^(\d{7})\.jpg$/);
  if (dv) return dv[1];

  // NASA art-series: art<digits>e<digits>
  const n = filename.match(/^(art\d+e\d+)/);
  if (n) return n[1];

  // Instagram embed
  const ig = filename.match(/^(ig-[a-z0-9-]+)\./);
  if (ig) return ig[1];

  // YouTube embed
  const yt = filename.match(/^(yt-[a-z0-9-]+)\./);
  if (yt) return yt[1];

  // Fallback: strip ~large/~orig suffix and extension; use whatever's left
  const base = filename
    .replace(/~(large|orig)/, '')
    .replace(/\.[^.]+$/, '');
  return base || null;
}

/**
 * Slugify any string into a URL-safe lowercase form with dashes.
 *
 * @param {string} s
 * @returns {string}
 */
function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Produce the URL-hash slug for a photo entry.
 *
 * The browser viewer uses this for deep linking — each photo gets a hash
 * like `#christina-koch-smiles-before-launch` so a single photo can be
 * shared or bookmarked. The viewer's inline version reads a global
 * PHOTO_TITLES map; here we take the title explicitly.
 *
 * Falls back through: title → flickr/source ID → filename without extension.
 *
 * @param {{ file: string, title?: string }} entry
 * @returns {string}
 */
function photoSlug({ file, title }) {
  if (title) return slugify(title);
  const fid = getFlickrId(file);
  if (fid) return fid;
  return file.replace(/\.[^.]+$/, '');
}

module.exports = { getFlickrId, slugify, photoSlug };

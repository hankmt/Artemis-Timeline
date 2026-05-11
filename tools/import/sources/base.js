/**
 * Source adapter interface.
 *
 * Every file in `tools/import/sources/` (other than this one) must export
 * a `discover` function with the signature documented below, plus a `NAME`
 * string identifying the adapter.
 *
 * This file is not imported anywhere — it exists as documentation and as a
 * place to define the candidate shape used by all adapters.
 */

'use strict';

/**
 * @typedef {Object} Candidate
 *
 * The normalized record every adapter produces. The orchestrator
 * (sync.js) dedups, classifies, and writes these to inbox.json.
 *
 * @property {string}   source           - adapter NAME (e.g. "nasa_library")
 * @property {string}   source_id        - stable ID at the source
 * @property {string}   source_url       - human-friendly URL at the source
 * @property {string}   image_url        - direct URL to the full-resolution image
 *                                          (used at promote time as the source
 *                                          for the local web/ copy)
 * @property {string}   thumb_url        - direct URL to a small thumbnail
 *                                          (used by the admin Pending tab to
 *                                          render review thumbnails)
 * @property {string}   title            - human-readable title
 * @property {string}   description      - longer-form description
 * @property {string}   photographer     - photographer credit; "NASA" or "" if unknown
 * @property {string}   location         - free-text facility / city; "" if unknown
 * @property {string}   center           - NASA center code if applicable:
 *                                          KSC / JSC / MSFC / SSC / MAF / HQ /
 *                                          GSFC / GRC / LARC / AFRC / ARC.
 *                                          Empty string for in-flight, recovery,
 *                                          or non-NASA locations.
 * @property {string}   camera           - camera model (typically "" for non-EXIF sources)
 * @property {string}   settings         - exposure settings (typically "" for non-EXIF sources)
 * @property {string}   taken_at         - "YYYY-MM-DD HH:MM:SS" in EDT, best-available
 *                                          timestamp from the source
 * @property {string[]} tags             - keyword tags from the source
 * @property {boolean}  spacecraft       - taken from inside the spacecraft?
 * @property {boolean}  video            - is this a video?
 * @property {string}   source_default_era - adapter's baseline guess: one of
 *                                            "pre-flight-hardware", "pre-flight-training",
 *                                            "mission", "post-mission", or "unknown"
 */

/**
 * @typedef {Object} DiscoverOptions
 *
 * @property {Set<string>} [seenIds]      - source_ids the orchestrator
 *                                           already knows about; adapter
 *                                           may use this for early-stop
 *                                           heuristics
 * @property {boolean}     [fullRescan]   - if true, walk full result space
 *                                           instead of stopping at the first
 *                                           run of already-seen items
 * @property {number}      [limit]        - hard cap on candidates returned
 *                                           across all queries in this run
 *                                           (the kill switch)
 * @property {string[]}    [queries]      - override the adapter's default
 *                                           query list
 */

/**
 * @typedef {Object} DiscoverResult
 *
 * @property {Candidate[]} candidates
 * @property {Object}      [debugInfo]    - opaque per-run info for logging
 */

/**
 * @typedef {Object} Adapter
 *
 * @property {string} NAME                              - adapter identifier
 * @property {string} [SOURCE_DEFAULT_ERA]              - default era for this adapter's output
 * @property {(opts: DiscoverOptions) => Promise<DiscoverResult>} discover
 */

module.exports = {};   // documentation-only module

#!/usr/bin/env node
/**
 * NASA Image and Video Library adapter.
 *
 * Queries https://images-api.nasa.gov/search for Artemis II imagery and
 * returns normalized candidate records.
 *
 * No API key required for read. Rate-limit risk is low at our scale but
 * we courtesy-throttle between page fetches (DELAY_MS) anyway.
 *
 * The API's search results already include direct URLs to each asset's
 * thumb/small/medium/large/orig versions in items[].links[], so no second
 * "asset endpoint" round-trip is needed during discovery.
 *
 * Standalone test mode:
 *   node tools/import/sources/nasa-library.js --limit 5
 *   node tools/import/sources/nasa-library.js --query "Artemis II crew training" --limit 10
 *   node tools/import/sources/nasa-library.js --query "SLS Block 1" --limit 10 --json
 *
 * The standalone mode never writes to inbox/state and never calls a network
 * downloader — it's strictly for inspecting what the API returns and what
 * the adapter normalizes it into.
 */

'use strict';

const path = require('path');
const { toPhotosTime } = require('../shared/dates');

const NAME = 'nasa_library';
const SOURCE_DEFAULT_ERA = 'unknown';   // NASA Library results are mixed-content;
                                        // let the per-image classifier decide.

const API_BASE = 'https://images-api.nasa.gov';
const DELAY_MS = 200;                   // courtesy delay between pages
const PAGE_SIZE = 100;                  // NASA API max page size
const STOP_AFTER_CONSECUTIVE_SEEN = 10; // incremental-run early-stop threshold

// Default query set. Override via the `queries` option in DiscoverOptions
// or via --query flag in standalone test mode. Order matters only for
// ordering of the consolidated results; everything is deduped at the end.
const DEFAULT_QUERIES = [
  'Artemis II',
  'Artemis II crew',
  'Artemis II SLS',
  'Artemis II Orion',
  'Artemis II training',
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Fetch one page of search results. Returns { items, total_hits }.
 */
async function searchPage(query, page) {
  const url = new URL(API_BASE + '/search');
  url.searchParams.set('q', query);
  url.searchParams.set('media_type', 'image');
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(PAGE_SIZE));

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`NASA Library API ${res.status}: ${res.statusText} (${url})`);
  }
  const json = await res.json();
  const c = json.collection || {};
  return {
    items: c.items || [],
    total_hits: (c.metadata && c.metadata.total_hits) || 0,
  };
}

/**
 * Categorize a link by its size suffix in the URL. NASA Image Library
 * URLs end with one of ~thumb / ~small / ~medium / ~large / ~orig before
 * the extension. We use these to pick the right size for each purpose:
 *
 *   - Full-quality download: prefer ~large (typically 1242x1920, ~180KB —
 *     fine for the timeline viewer; saves us a heavy ~orig download + an
 *     ImageMagick resize round-trip).
 *   - Thumbnail for admin UI: prefer ~small (414x640, ~21KB).
 *
 * Falls back gracefully to whatever sizes the asset happens to have.
 */
function sizeOfLink(href) {
  if (typeof href !== 'string') return null;
  const m = href.match(/~(thumb|small|medium|large|orig)\.[a-z0-9]+($|\?)/i);
  return m ? m[1].toLowerCase() : null;
}

function pickByPreference(links, preferences) {
  if (!Array.isArray(links)) return null;
  const bySize = {};
  for (const l of links) {
    if (!l || !l.href || l.render !== 'image') continue;
    const size = sizeOfLink(l.href);
    if (size) bySize[size] = l.href;
  }
  for (const want of preferences) {
    if (bySize[want]) return bySize[want];
  }
  // Last-resort: any image link we found
  return Object.values(bySize)[0] || null;
}

function pickImageUrl(links) {
  // For promotion: target ~1200-1600px wide. "large" is the sweet spot —
  // smaller than orig but already web-sized, so we can use it as-is.
  return pickByPreference(links, ['large', 'medium', 'orig', 'small', 'thumb']);
}

function pickThumbUrl(links) {
  // For admin Pending tab: small is plenty.
  return pickByPreference(links, ['small', 'thumb', 'medium', 'large']);
}

/**
 * Convert NASA's "YYYY-MM-DDTHH:MM:SSZ" (UTC) to our EDT string format.
 * If parsing fails, returns an empty string and lets the reviewer fill it
 * in manually rather than guessing.
 */
function nasaDateToEdt(dateCreated) {
  if (!dateCreated) return '';
  const t = Date.parse(dateCreated);
  if (Number.isNaN(t)) return '';
  return toPhotosTime(t);
}

/**
 * Extract the photographer credit from a NASA Library data record.
 * The Library doesn't have a dedicated photographer field — credit
 * appears most often in `secondary_creator` or `photographer` if at all.
 */
function extractPhotographer(d) {
  // Some entries use `secondary_creator` as photographer credit.
  if (d.secondary_creator) return String(d.secondary_creator).trim();
  if (d.photographer)      return String(d.photographer).trim();
  return 'NASA';
}

/**
 * NASA center codes used by the Library API (and our internal schema).
 * Exported so other modules (migrate, viewer) can use the same mapping.
 */
const CENTER_NAMES = {
  HQ:   'NASA Headquarters',
  KSC:  'Kennedy Space Center',
  JSC:  'Johnson Space Center',
  MSFC: 'Marshall Space Flight Center',
  SSC:  'Stennis Space Center',
  GSFC: 'Goddard Space Flight Center',
  GRC:  'Glenn Research Center',
  LARC: 'Langley Research Center',
  AFRC: 'Armstrong Flight Research Center',
  ARC:  'Ames Research Center',
  MAF:  'Michoud Assembly Facility',
};

/**
 * Extract a location hint from a NASA Library data record. The Library's
 * `location` field is rarely populated; `center` is almost always present.
 * Expand center codes to readable names.
 */
function extractLocation(d) {
  if (d.location) return String(d.location).trim();
  if (d.center && CENTER_NAMES[d.center]) return CENTER_NAMES[d.center];
  if (d.center) return d.center;
  return '';
}

/**
 * Return the NASA center code (e.g. "KSC") for a data record, or "" if the
 * record's center field is missing or unrecognized.
 */
function extractCenter(d) {
  if (!d.center) return '';
  const c = String(d.center).toUpperCase().trim();
  return CENTER_NAMES[c] ? c : c;   // pass through unknown codes verbatim
}

/**
 * Normalize a NASA Library `items[i]` record into the Candidate shape
 * defined in sources/base.js.
 */
function normalizeItem(item) {
  const d = (item.data && item.data[0]) || {};
  const description = d.description || d.description_508 || '';
  const imageUrl = pickImageUrl(item.links);
  const thumbUrl = pickThumbUrl(item.links);

  return {
    source: NAME,
    source_id: d.nasa_id || '',
    source_url: d.nasa_id
        ? `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`
        : '',
    image_url: imageUrl || '',
    thumb_url: thumbUrl || imageUrl || '',
    title: (d.title || '').trim(),
    description: description.trim(),
    photographer: extractPhotographer(d),
    location: extractLocation(d),
    center: extractCenter(d),
    camera: '',
    settings: '',
    taken_at: nasaDateToEdt(d.date_created),
    tags: Array.isArray(d.keywords) ? d.keywords : [],
    spacecraft: false,           // NASA Library doesn't tag this; reviewer
                                  // toggles in admin if photo is from inside Orion
    video: false,                // we filter media_type=image upstream
    source_default_era: SOURCE_DEFAULT_ERA,
  };
}

/**
 * Main entrypoint. See base.js for the DiscoverOptions / DiscoverResult
 * documentation.
 */
async function discover(opts = {}) {
  const seenIds = opts.seenIds || new Set();
  const fullRescan = !!opts.fullRescan;
  const limit = Math.max(1, opts.limit | 0) || 100;
  const queries = (opts.queries && opts.queries.length) ? opts.queries : DEFAULT_QUERIES;
  const centers = (opts.centers && opts.centers.length)
      ? new Set(opts.centers.map(c => String(c).toUpperCase()))
      : null;

  const candidates = [];
  const debugInfo = {
    queries: queries.slice(),
    centersFilter: centers ? Array.from(centers) : null,
    perQuery: {},
    totalHitsAcrossQueries: 0,
    filteredOutByCenter: 0,
  };

  // Track how many candidates we'd accumulated before each query started, so
  // we can compute "addedThisQuery" no matter how the query iteration exits.
  let accumulatedBeforeQuery = 0;

  function recordQueryDebug(q, ctx) {
    debugInfo.perQuery[q] = {
      totalHits: ctx.totalHits,
      pagesFetched: ctx.pagesFetched,
      addedThisQuery: candidates.length - accumulatedBeforeQuery,
      stoppedEarly: ctx.stoppedEarly,
      reachedLimit: ctx.reachedLimit,
    };
    debugInfo.totalHitsAcrossQueries += ctx.totalHits || 0;
    accumulatedBeforeQuery = candidates.length;
  }

  outer: for (const q of queries) {
    let page = 1;
    let consecutiveSeen = 0;
    let pagesFetched = 0;
    let totalHits = null;
    let stoppedEarly = false;
    let reachedLimit = false;

    while (candidates.length < limit) {
      const { items, total_hits } = await searchPage(q, page);
      if (totalHits === null) totalHits = total_hits;
      pagesFetched++;

      if (items.length === 0) break;

      for (const item of items) {
        const cand = normalizeItem(item);
        if (!cand.source_id) continue;          // skip malformed

        if (seenIds.has(cand.source_id)) {
          consecutiveSeen++;
          if (!fullRescan && consecutiveSeen >= STOP_AFTER_CONSECUTIVE_SEEN) {
            stoppedEarly = true;
            break;
          }
          continue;
        }
        // Center filter: skip records whose center isn't in the allowed set.
        // Records with no center field are filtered out when a centers
        // restriction is in effect.
        if (centers && !centers.has(cand.center)) {
          debugInfo.filteredOutByCenter++;
          continue;
        }
        consecutiveSeen = 0;
        candidates.push(cand);
        seenIds.add(cand.source_id);            // dedup within this run too
        if (candidates.length >= limit) {
          reachedLimit = true;
          break;
        }
      }

      if (stoppedEarly) break;
      if (reachedLimit) break;

      page++;
      await sleep(DELAY_MS);
    }

    recordQueryDebug(q, { totalHits, pagesFetched, stoppedEarly, reachedLimit });
    if (reachedLimit) break outer;
  }

  return { candidates, debugInfo };
}

// -------------------------------------------------------------------------
// Standalone test mode
// -------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { limit: 5, query: null, fullRescan: false, json: false, centers: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit')        args.limit = parseInt(argv[++i], 10) || 5;
    else if (a === '--query')   args.query = argv[++i];
    else if (a === '--centers') args.centers = argv[++i].split(/[,\s]+/).filter(Boolean);
    else if (a === '--full-rescan') args.fullRescan = true;
    else if (a === '--json')    args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node ${path.basename(__filename)} [options]

Options:
  --limit N          Max candidates to return (default 5)
  --query "STR"      Override default query set with a single query
  --centers LIST     Restrict to a comma-separated list of NASA center codes
                     (e.g. --centers KSC,JSC,MSFC). Records with no recognized
                     center are filtered out when this flag is used.
  --full-rescan      Don't stop at consecutive-seen heuristic
  --json             Output raw JSON (instead of human-readable summary)
  -h, --help         Show this help

The standalone mode does not write to any file. It only prints what would
be passed to the orchestrator.`);
}

async function standalone() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  const opts = {
    limit: args.limit,
    fullRescan: args.fullRescan,
    queries: args.query ? [args.query] : undefined,
    centers: args.centers || undefined,
  };

  console.error(`[nasa_library] discovering (limit=${args.limit}, fullRescan=${args.fullRescan}, centers=${(args.centers || []).join(',') || 'any'}, queries=${(opts.queries || DEFAULT_QUERIES).join(' | ')})...`);
  const result = await discover(opts);

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  console.log(`=== ${result.candidates.length} candidates ===`);
  for (const c of result.candidates) {
    console.log('');
    console.log(`  ID:       ${c.source_id}`);
    console.log(`  Title:    ${c.title}`);
    console.log(`  Taken:    ${c.taken_at || '(unknown)'}`);
    console.log(`  Center:   ${c.center || '(none)'}`);
    console.log(`  By:       ${c.photographer}`);
    console.log(`  At:       ${c.location || '(unspecified)'}`);
    console.log(`  Tags:     ${c.tags.slice(0, 5).join(', ')}${c.tags.length > 5 ? '...' : ''}`);
    console.log(`  Image:    ${c.image_url || '(no canonical URL)'}`);
    if (c.description) {
      const d = c.description.replace(/\s+/g, ' ').trim();
      console.log(`  Desc:     ${d.slice(0, 120)}${d.length > 120 ? '...' : ''}`);
    }
  }
  console.log('');
  console.log('=== debug ===');
  console.log(JSON.stringify(result.debugInfo, null, 2));
}

if (require.main === module) {
  standalone().catch(err => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
}

module.exports = { NAME, SOURCE_DEFAULT_ERA, CENTER_NAMES, discover };

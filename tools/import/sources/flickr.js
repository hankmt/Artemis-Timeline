#!/usr/bin/env node
/**
 * Flickr adapter for the acquisition pipeline.
 *
 * Pulls Artemis II imagery from NASA-run Flickr photostreams via the
 * Flickr REST API (https://api.flickr.com/services/rest/).
 *
 * Credential: FLICKR_API_KEY in tools/import/.env.local (gitignored).
 * To get a key: https://www.flickr.com/services/apps/create/apply/
 *
 * Source coverage (default):
 *
 *   1. NASA Johnson's curated "Artemis II" photoset (id 72177720307234654).
 *      ~407 photos as of May 2026, very low noise — these are NASA's own
 *      Artemis II selection. Most-efficient starting point.
 *
 *   2. NASA HQ Photo's photostream, narrowed to "Artemis II" via search.
 *      Pulls launch/recovery press photos that didn't land in the curated
 *      album. Higher recall, slightly more dedup against Hank's data.
 *
 * Each source produces candidates with a distinct `source` label
 * (flickr_nasajohnson_artemis2, flickr_nasahqphoto, …) so the admin
 * Pending tab can filter by which photostream a candidate came from.
 *
 * Standalone test mode:
 *   node tools/import/sources/flickr.js --limit 5
 *   node tools/import/sources/flickr.js --source artemis2 --limit 5 --json
 */

'use strict';

const path = require('path');
const { requireCredential } = require('../shared/env');

const NAME = 'flickr';
const SOURCE_DEFAULT_ERA = 'unknown';

const API_BASE = 'https://api.flickr.com/services/rest/';
const PAGE_SIZE = 100;
const DELAY_MS = 200;
const STOP_AFTER_CONSECUTIVE_SEEN = 10;

// Comma-separated list of optional fields to ask Flickr to return per
// photo. Without these the basic listing returns id/owner/title only.
const EXTRAS = 'description,date_taken,owner_name,tags,url_l,url_s,url_o';

// Per-source configurations. Each one produces candidates labeled with
// its own source string and (when known) a baseline NASA center.
//
// NSIDs verified via flickr.urls.lookupUser. Don't trust the URL alias —
// e.g. "nasa2explore" is the alias for NASA Johnson, NSID 29988733@N04,
// and the URL alias "nasakennedy" maps to 108488366@N07.
const DEFAULT_SOURCES = [
  // NASA Johnson's curated Artemis II album. Cleanest possible starting set.
  // The photoset ID is globally unique so we don't need a user_id here.
  {
    key: 'artemis2',
    kind: 'photoset',
    source_label: 'flickr_nasajohnson_artemis2',
    photoset_id: '72177720307234654',
    default_center: 'JSC',
    note: 'NASA Johnson\'s curated Artemis II photoset',
  },
  // NASA HQ Photo's full photostream, narrowed by free-text search.
  // Mix of launch press, walkout, splashdown, and HQ briefings.
  {
    key: 'nasahq',
    kind: 'user_search',
    source_label: 'flickr_nasahqphoto',
    user_id: '35067687@N04',                 // NASA HQ Photo
    text: 'Artemis II',
    default_center: 'HQ',
    note: 'NASA HQ Photo photostream, text="Artemis II"',
  },
  // NASA Kennedy photostream — launch operations, pad ops, integration.
  // Primary source for KSC-side mission-week imagery.
  {
    key: 'kennedy',
    kind: 'user_search',
    source_label: 'flickr_nasakennedy',
    user_id: '108488366@N07',                // NASAKennedy
    text: 'Artemis II',
    default_center: 'KSC',
    note: 'NASA Kennedy photostream, text="Artemis II"',
  },
  // NASA Marshall photostream — SLS hardware, engine tests, core stage.
  // Primary source for pre-flight-hardware imagery (the era bucket we have
  // zero of in canon today).
  {
    key: 'marshall',
    kind: 'user_search',
    source_label: 'flickr_nasamarshall',
    user_id: '28634332@N05',                 // NASA's Marshall Space Flight Center
    text: 'Artemis II',
    default_center: 'MSFC',
    note: 'NASA Marshall photostream, text="Artemis II"',
  },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Word-boundary regex for Artemis II: matches "Artemis II", "Artemis II.",
// "Artemis II crew", etc. — does NOT match "Artemis III" or "Artemis IIII"
// because there's no word boundary between consecutive 'I' characters.
//
// Flickr's `text` search parameter does substring matching, so a query for
// "Artemis II" returns hits where the literal substring appears anywhere in
// title / description / tags — including within "Artemis III". This regex
// catches the false positives at the adapter level so the orchestrator
// downstream never sees them.
const ARTEMIS_II_RE = /\bArtemis\s+II\b/i;

// Other Artemis missions whose presence in the *title* disqualifies a
// candidate regardless of whether the description happens to mention
// Artemis II in passing. Titles are authoritative: the post creator is
// telling you what the post is about.
const OTHER_ARTEMIS_TITLE_RE = /\bArtemis\s+(I|III|IV|V|VI|VII|VIII|IX|X|3|4|5)\b/i;

/**
 * Return true if the candidate has at least one strong "Artemis II"
 * signal AND its title doesn't explicitly call out a different Artemis
 * mission. Used to reject content that slipped through Flickr's
 * substring-based search.
 */
function mentionsArtemisII(candidate) {
  // First: if the title explicitly says "Artemis III" / "Artemis I" / etc.,
  // reject regardless of any Artemis II mention in the description.
  if (OTHER_ARTEMIS_TITLE_RE.test(candidate.title || '')) {
    // BUT — if the title also explicitly says Artemis II (e.g. "Artemis II
    // and Artemis III comparison"), keep the post and let the reviewer
    // decide.
    if (!ARTEMIS_II_RE.test(candidate.title || '')) return false;
  }

  // Otherwise: any Artemis II signal in title, description, or tags wins.
  if (ARTEMIS_II_RE.test(candidate.title || '')) return true;
  if (ARTEMIS_II_RE.test(candidate.description || '')) return true;
  if (Array.isArray(candidate.tags)) {
    for (const t of candidate.tags) {
      if (ARTEMIS_II_RE.test(t)) return true;
      // Flickr machine-tag conventions: "artemis2" / "artemisii".
      if (/^artemis(2|ii)$/i.test(t)) return true;
    }
  }
  return false;
}

// -------------------------------------------------------------------------
// API wrappers
// -------------------------------------------------------------------------

async function flickrApi(apiKey, method, params) {
  const url = new URL(API_BASE);
  url.searchParams.set('method', method);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('nojsoncallback', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Flickr ${method} HTTP ${res.status} ${res.statusText}`);
  }
  const json = await res.json();
  if (json.stat !== 'ok') {
    throw new Error(`Flickr ${method} failed: ${json.message || JSON.stringify(json)}`);
  }
  return json;
}

async function fetchPhotosetPage(apiKey, photosetId, page) {
  const json = await flickrApi(apiKey, 'flickr.photosets.getPhotos', {
    photoset_id: photosetId,
    per_page: String(PAGE_SIZE),
    page: String(page),
    extras: EXTRAS,
  });
  return {
    photos: (json.photoset && json.photoset.photo) || [],
    pages: (json.photoset && json.photoset.pages) || 1,
    total: parseInt((json.photoset && json.photoset.total) || '0', 10),
  };
}

async function fetchUserSearchPage(apiKey, userId, text, page) {
  const json = await flickrApi(apiKey, 'flickr.photos.search', {
    user_id: userId,
    text: text,
    per_page: String(PAGE_SIZE),
    page: String(page),
    extras: EXTRAS,
  });
  return {
    photos: (json.photos && json.photos.photo) || [],
    pages: (json.photos && json.photos.pages) || 1,
    total: parseInt((json.photos && json.photos.total) || '0', 10),
  };
}

// -------------------------------------------------------------------------
// Normalization
// -------------------------------------------------------------------------

/**
 * Strip the HTML Flickr embeds in descriptions and unescape the common
 * entities. Flickr passes descriptions back as HTML even via the JSON API.
 */
function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Map the photostream owner display name to a photographer credit. NASA
 * accounts don't credit individual photographers in the ownername field,
 * so we default to "NASA" and let normalize.js polish further when sync
 * runs.
 */
function inferPhotographer(ownername) {
  if (!ownername) return 'NASA';
  // For known NASA accounts: don't attribute the institutional name as
  // photographer. The reviewer can fill in a specific name during admin.
  if (/^(NASA Johnson|NASA HQ|NASA Kennedy|NASA Marshall|NASA Goddard|nasahqphoto|nasa2explore|NASA Photo One)$/i.test(ownername)) {
    return 'NASA';
  }
  return ownername;
}

/**
 * Convert a Flickr photo record into the Candidate shape.
 */
function normalizeItem(item, sourceCfg) {
  const id = String(item.id || '');
  const description = stripHtml(item.description && item.description._content);
  const tags = item.tags ? String(item.tags).split(/\s+/).filter(Boolean) : [];

  // Flickr's "owner" field is the photographer's NSID; "ownername" is
  // the display name. For the source URL we'd prefer the path-alias if
  // known, but the NSID works fine in Flickr URLs too.
  const ownerSlug = item.owner || '';
  const sourceUrl = id && ownerSlug
      ? `https://www.flickr.com/photos/${ownerSlug}/${id}/`
      : `https://www.flickr.com/photo.gne?id=${id}`;

  return {
    source: sourceCfg.source_label,
    source_id: id,
    source_url: sourceUrl,
    image_url: item.url_l || item.url_o || '',
    thumb_url: item.url_s || item.url_l || '',
    title: (item.title || '').trim(),
    description,
    photographer: inferPhotographer(item.ownername),
    location: '',
    center: sourceCfg.default_center || '',
    camera: '',
    settings: '',
    // Flickr already returns "YYYY-MM-DD HH:MM:SS" in datetaken (local
    // photographer time, which for NASA photos is overwhelmingly EDT or
    // close enough — reviewer can refine if a specific photo has drifted).
    taken_at: item.datetaken || '',
    tags,
    spacecraft: false,
    video: false,
    source_default_era: SOURCE_DEFAULT_ERA,
  };
}

// -------------------------------------------------------------------------
// Discover
// -------------------------------------------------------------------------

async function discover(opts = {}) {
  const seenIds = opts.seenIds || new Set();
  const fullRescan = !!opts.fullRescan;
  const limit = Math.max(1, opts.limit | 0) || 100;
  const sources = opts.sources || DEFAULT_SOURCES;

  const apiKey = requireCredential('FLICKR_API_KEY');

  const candidates = [];
  const debugInfo = { perSource: {} };
  let accumulatedBeforeSource = 0;

  for (const src of sources) {
    if (candidates.length >= limit) break;

    let page = 1;
    let totalPages = null;
    let total = null;
    let pagesFetched = 0;
    let consecutiveSeen = 0;
    let stoppedEarly = false;
    let reachedLimit = false;
    let falsePositivesFiltered = 0;

    while (candidates.length < limit) {
      let result;
      try {
        if (src.kind === 'photoset')         result = await fetchPhotosetPage(apiKey, src.photoset_id, page);
        else if (src.kind === 'user_search') result = await fetchUserSearchPage(apiKey, src.user_id, src.text, page);
        else throw new Error(`unknown flickr source kind: ${src.kind}`);
      } catch (err) {
        // Per-source errors shouldn't kill the whole sync. Record and continue.
        debugInfo.perSource[src.source_label] = { error: err.message, page, pagesFetched };
        break;
      }

      if (totalPages === null) { totalPages = result.pages; total = result.total; }
      pagesFetched++;

      if (result.photos.length === 0) break;

      for (const photo of result.photos) {
        const cand = normalizeItem(photo, src);
        if (!cand.source_id) continue;

        // For text-search sources, reject anything that slipped through
        // Flickr's substring match without actually being Artemis II.
        // Album/photoset sources are curated upstream, so we trust them.
        if (src.kind === 'user_search' && !mentionsArtemisII(cand)) {
          falsePositivesFiltered++;
          continue;
        }

        if (seenIds.has(cand.source_id)) {
          consecutiveSeen++;
          if (!fullRescan && consecutiveSeen >= STOP_AFTER_CONSECUTIVE_SEEN) {
            stoppedEarly = true;
            break;
          }
          continue;
        }
        consecutiveSeen = 0;
        candidates.push(cand);
        seenIds.add(cand.source_id);
        if (candidates.length >= limit) {
          reachedLimit = true;
          break;
        }
      }

      if (stoppedEarly || reachedLimit) break;
      if (page >= totalPages) break;
      page++;
      await sleep(DELAY_MS);
    }

    debugInfo.perSource[src.source_label] = {
      kind: src.kind,
      totalPages,
      total,
      pagesFetched,
      addedThisSource: candidates.length - accumulatedBeforeSource,
      falsePositivesFiltered,
      stoppedEarly,
      reachedLimit,
    };
    accumulatedBeforeSource = candidates.length;
  }

  return { candidates, debugInfo };
}

// -------------------------------------------------------------------------
// Standalone test mode
// -------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { limit: 5, source: null, fullRescan: false, json: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit')         args.limit = parseInt(argv[++i], 10) || 5;
    else if (a === '--source')   args.source = argv[++i];
    else if (a === '--full-rescan') args.fullRescan = true;
    else if (a === '--json')     args.json = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node ${path.basename(__filename)} [options]

Options:
  --limit N            Max candidates total (default 5)
  --source KEY         Limit to one configured source by its key:
                         ${DEFAULT_SOURCES.map(s => s.key).join(', ')}
  --full-rescan        Don't stop at consecutive-seen
  --json               Output raw JSON
  -h, --help           Show this help

Requires FLICKR_API_KEY in tools/import/.env.local (or env var).`);
}

async function standalone() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  const sources = args.source
      ? DEFAULT_SOURCES.filter(s => s.key === args.source)
      : DEFAULT_SOURCES;
  if (args.source && sources.length === 0) {
    throw new Error(`Unknown --source "${args.source}". Known: ${DEFAULT_SOURCES.map(s => s.key).join(', ')}`);
  }

  console.error(`[flickr] discovering from sources: ${sources.map(s => s.source_label).join(', ')}, limit=${args.limit}`);
  const result = await discover({ limit: args.limit, fullRescan: args.fullRescan, sources });

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('');
  console.log(`=== ${result.candidates.length} candidates ===`);
  for (const c of result.candidates) {
    console.log('');
    console.log(`  ID:     ${c.source_id}`);
    console.log(`  Title:  ${c.title}`);
    console.log(`  Taken:  ${c.taken_at || '(unknown)'}`);
    console.log(`  Source: ${c.source}`);
    console.log(`  Center: ${c.center || '(none)'}`);
    console.log(`  By:     ${c.photographer}`);
    console.log(`  Tags:   ${c.tags.slice(0, 5).join(', ')}${c.tags.length > 5 ? '...' : ''}`);
    console.log(`  Image:  ${c.image_url || '(no URL)'}`);
    if (c.description) {
      const d = c.description.replace(/\s+/g, ' ').trim();
      console.log(`  Desc:   ${d.slice(0, 120)}${d.length > 120 ? '...' : ''}`);
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

module.exports = { NAME, SOURCE_DEFAULT_ERA, DEFAULT_SOURCES, discover };

#!/usr/bin/env node
/**
 * Acquisition pipeline orchestrator.
 *
 * Wires the source adapters, normalizers, and classifier together:
 *
 *   1. Load persistent state (state.json) and existing canonical data
 *      (photos.js) and the pending review queue (inbox.json).
 *   2. Build a single `seenIds` Set from all four sources so we never
 *      re-discover anything we've already processed.
 *   3. Run each source adapter (NASA Image Library now; Flickr later)
 *      with a hard `limit` cap.
 *   4. For each new candidate: normalize → classify → score quality.
 *   5. Append to inbox.json; update state.json's seen set; write a
 *      per-run log.
 *
 * Downloads and image resizing are NOT done here yet — that comes in a
 * follow-up commit. For now, candidates land in inbox.json with the
 * source's image URL intact, and the admin Pending tab will load the
 * thumbnail straight from the source (cheap to verify the flow works
 * end-to-end before we commit disk to anything).
 *
 * Usage:
 *   node tools/import/sync.js                          # default settings
 *   node tools/import/sync.js --limit 20               # tight cap
 *   node tools/import/sync.js --source nasa_library    # one adapter only
 *   node tools/import/sync.js --query "Artemis II SLS" # one query
 *   node tools/import/sync.js --centers MSFC,SSC       # one or more centers
 *   node tools/import/sync.js --full-rescan            # ignore early-stop
 *   node tools/import/sync.js --dry-run                # don't write anything
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');

const { readPhotosJs } = require('./shared/photos-io');
const { isoEdt } = require('./shared/dates');
const { normalizeCandidate } = require('./normalize');
const { classify } = require('./classify');

const nasaLibrary = require('./sources/nasa-library');
const flickr      = require('./sources/flickr');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const PHOTOS_JS  = path.join(REPO_ROOT, 'photos.js');
const STATE_JSON = path.join(__dirname, 'state.json');
const INBOX_JSON = path.join(__dirname, 'inbox.json');
const LOG_DIR    = path.join(__dirname, 'log');

// Adapters run in declaration order. seenIds is shared across them so a
// later adapter doesn't re-emit what an earlier one already added this run.
const ADAPTERS = [nasaLibrary, flickr];
const DEFAULT_LIMIT = 50;

// ---------------------------------------------------------------------------
// State + inbox I/O
// ---------------------------------------------------------------------------

async function loadJsonOr(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Failed to read ${filePath}: ${e.message}`);
  }
}

async function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, filePath);
}

async function loadState() {
  const state = await loadJsonOr(STATE_JSON, {
    seen: [],
    rejected: [],
    lastRunAt: null,
    cursors: {},
  });
  // Defensive: ensure arrays exist even if state was hand-edited.
  state.seen     = state.seen     || [];
  state.rejected = state.rejected || [];
  state.cursors  = state.cursors  || {};
  return state;
}

async function loadInbox() {
  const inbox = await loadJsonOr(INBOX_JSON, []);
  return Array.isArray(inbox) ? inbox : [];
}

// ---------------------------------------------------------------------------
// Quality scoring (per EDITORIAL.md must-haves)
// ---------------------------------------------------------------------------

/**
 * Score a candidate against EDITORIAL.md's must-haves. Returns:
 *
 *   { score: "green" | "yellow" | "red",
 *     failures: [{ field, reason }, ...] }
 *
 * Each failure record contains enough info for the admin Pending tab to
 * say "this card is yellow because: title is just the source ID,
 * photographer is generic NASA."
 */
function scoreQuality(candidate) {
  let weak = 0;
  const failures = [];

  const title = (candidate.title || '').trim();
  if (!title || title.length < 5) {
    weak++;
    failures.push({ field: 'title', reason: 'missing or very short title' });
  } else if (candidate.source_id && title.includes(candidate.source_id)) {
    // Many NASA Library titles end with the source ID, e.g. "... -- jsc2024e055108".
    // Recognizable but not exactly editorial gold.
    weak += 0.5;
    failures.push({ field: 'title', reason: 'title contains the source ID — consider rewriting' });
  }

  if (!candidate.taken_at) {
    weak++;
    failures.push({ field: 'taken_at', reason: 'no defensible timestamp' });
  }

  if (!candidate.photographer || candidate.photographer === 'NASA') {
    weak++;
    failures.push({ field: 'photographer', reason: 'photographer is generic "NASA" — specific credit preferred' });
  }

  const desc = (candidate.description || '').trim();
  if (!desc) {
    weak++;
    failures.push({ field: 'description', reason: 'description is empty' });
  } else if (desc.length < title.length + 20) {
    weak += 0.5;
    failures.push({ field: 'description', reason: 'description barely longer than title — likely lacking context' });
  }

  let score;
  if (weak <= 0.5)      score = 'green';
  else if (weak <= 2)   score = 'yellow';
  else                  score = 'red';

  return { score, failures };
}

/**
 * Best-guess explanation of where the `center` value on a candidate
 * came from. NASA Library adapters populate this from the API's `center`
 * code; other sources may derive it differently. Reviewer-friendly text.
 */
function explainCenterSource(candidate) {
  if (!candidate.center) {
    return {
      kind: 'absent',
      note: 'no NASA center associated (likely in-flight, recovery, or non-NASA setting)',
    };
  }
  if (candidate.source === 'nasa_library') {
    return {
      kind: 'adapter',
      field: 'data[0].center',
      value: candidate.center,
      note: 'from NASA Image Library API\'s center code',
    };
  }
  return {
    kind: 'adapter',
    value: candidate.center,
    note: `from ${candidate.source} adapter`,
  };
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  const startedAt = isoEdt();
  console.log(`[sync] starting at ${startedAt}`);
  console.log(`[sync] limit=${args.limit}, fullRescan=${args.fullRescan}, dryRun=${args.dryRun}`);

  // Load state + canonical + inbox
  const state = await loadState();
  const photoData = await readPhotosJs(PHOTOS_JS);
  const inbox = await loadInbox();

  console.log(`[sync] state:    ${state.seen.length} seen, ${state.rejected.length} rejected`);
  console.log(`[sync] photos.js: ${photoData.photos.length} canonical entries`);
  console.log(`[sync] inbox.json: ${inbox.length} pending candidates`);

  // Build dedup Set from every place an ID might already be known.
  const seenIds = new Set([
    ...photoData.photos.map(p => p.source_id).filter(Boolean),
    ...inbox.map(c => c.source_id).filter(Boolean),
    ...state.seen,
    ...state.rejected,
  ]);
  console.log(`[sync] dedup set: ${seenIds.size} known IDs`);

  // Select adapters
  const adapters = args.source
      ? ADAPTERS.filter(a => a.NAME === args.source)
      : ADAPTERS;
  if (args.source && adapters.length === 0) {
    throw new Error(`No adapter named "${args.source}" — known: ${ADAPTERS.map(a => a.NAME).join(', ')}`);
  }

  // Discover from each adapter; share the seenIds set across runs so a
  // later adapter doesn't re-discover what an earlier one already added.
  const rawCandidates = [];
  const perAdapter = {};

  for (const adapter of adapters) {
    if (rawCandidates.length >= args.limit) break;
    console.log(`[sync] adapter: ${adapter.NAME}`);
    const remaining = args.limit - rawCandidates.length;
    const opts = {
      seenIds,
      fullRescan: args.fullRescan,
      limit: remaining,
    };
    if (args.query)   opts.queries = [args.query];
    if (args.centers) opts.centers = args.centers;

    const result = await adapter.discover(opts);
    console.log(`[sync]   ${result.candidates.length} candidates discovered`);
    perAdapter[adapter.NAME] = {
      added: result.candidates.length,
      debugInfo: result.debugInfo || null,
    };
    rawCandidates.push(...result.candidates);
  }

  console.log(`[sync] total raw: ${rawCandidates.length}`);

  // Normalize + classify + score
  const runAddedAt = isoEdt();
  const processed = rawCandidates.map(raw => {
    const normalized = normalizeCandidate(raw);
    const classified = classify(normalized);
    const { score: quality, failures: qualityFailures } = scoreQuality(normalized);
    const centerSource = explainCenterSource(normalized);

    // Assemble the unified evidence object. Classifier already populated
    // evidence.era_matches; we tack on quality and center evidence here so
    // every reviewer-facing decision is traceable from one place.
    const evidence = {
      ...(classified.evidence || {}),
      quality_failures: qualityFailures,
      center_source: centerSource,
    };

    return {
      ...normalized,
      classified,
      evidence,
      addedAt: runAddedAt,
      quality,
    };
  });

  // Stats by classification
  const byEra = {};
  const byConfidence = { high: 0, medium: 0, low: 0 };
  const byQuality = { green: 0, yellow: 0, red: 0 };
  for (const c of processed) {
    byEra[c.classified.era] = (byEra[c.classified.era] || 0) + 1;
    byConfidence[c.classified.confidence] = (byConfidence[c.classified.confidence] || 0) + 1;
    byQuality[c.quality] = (byQuality[c.quality] || 0) + 1;
  }
  console.log(`[sync] by era:        ${JSON.stringify(byEra)}`);
  console.log(`[sync] by confidence: ${JSON.stringify(byConfidence)}`);
  console.log(`[sync] by quality:    ${JSON.stringify(byQuality)}`);

  if (args.dryRun) {
    console.log('[sync] DRY RUN — not writing inbox/state');
    for (const c of processed.slice(0, 5)) {
      console.log('---');
      console.log(`  ${c.source_id}: ${c.title.slice(0, 70)}`);
      console.log(`  era:     ${c.classified.era} (${c.classified.confidence}) — ${c.classified.reason}`);
      console.log(`  quality: ${c.quality}`);
      console.log(`  by:      ${c.photographer}`);
      console.log(`  when:    ${c.taken_at}`);
    }
    if (processed.length > 5) console.log(`  ...and ${processed.length - 5} more`);
    return;
  }

  // Write inbox.json + state.json atomically
  const updatedInbox = [...inbox, ...processed];
  for (const c of processed) {
    if (c.source_id) state.seen.push(c.source_id);
  }
  state.lastRunAt = runAddedAt;

  await writeJsonAtomic(INBOX_JSON, updatedInbox);
  await writeJsonAtomic(STATE_JSON, state);

  // Per-run log: just dump the structured stats. Easy to grep later.
  // Filename includes millisecond suffix so back-to-back runs in the same
  // second don't collide.
  await fs.mkdir(LOG_DIR, { recursive: true });
  const logName = startedAt
      .replace(/[:T]/g, '-')
      .replace(/[+-]\d{2}:\d{2}$/, '');
  const ms = String(Date.now() % 1000).padStart(3, '0');
  const logFile = path.join(LOG_DIR, `run-${logName}-${ms}.log`);
  const logBody = [
    `[sync] startedAt:    ${startedAt}`,
    `[sync] finishedAt:   ${isoEdt()}`,
    `[sync] limit:        ${args.limit}`,
    `[sync] fullRescan:   ${args.fullRescan}`,
    `[sync] query:        ${args.query || '(default per adapter)'}`,
    `[sync] centers:      ${(args.centers || []).join(',') || '(any)'}`,
    `[sync] dedupSetSize: ${seenIds.size}`,
    `[sync] discovered:   ${rawCandidates.length}`,
    `[sync] byEra:        ${JSON.stringify(byEra)}`,
    `[sync] byConfidence: ${JSON.stringify(byConfidence)}`,
    `[sync] byQuality:    ${JSON.stringify(byQuality)}`,
    `[sync] perAdapter:   ${JSON.stringify(perAdapter, null, 2)}`,
  ].join('\n') + '\n';
  await fs.writeFile(logFile, logBody);

  console.log(`[sync] wrote ${updatedInbox.length} candidates to inbox`);
  console.log(`[sync] state: ${state.seen.length} seen total`);
  console.log(`[sync] log:   ${logFile}`);
  console.log('[sync] done.');
}

// ---------------------------------------------------------------------------
// CLI plumbing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    limit: DEFAULT_LIMIT,
    fullRescan: false,
    source: null,
    query: null,
    centers: null,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit')        args.limit = parseInt(argv[++i], 10) || DEFAULT_LIMIT;
    else if (a === '--full-rescan') args.fullRescan = true;
    else if (a === '--source')  args.source = argv[++i];
    else if (a === '--query')   args.query = argv[++i];
    else if (a === '--centers') args.centers = argv[++i].split(/[,\s]+/).filter(Boolean);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/import/sync.js [options]

Options:
  --limit N          Max new candidates this run, across all sources (default ${DEFAULT_LIMIT})
  --full-rescan      Ignore the consecutive-seen early-stop heuristic
  --source NAME      Only run the adapter with this name (e.g. nasa_library)
  --query "STR"      Override default queries with a single search string
  --centers LIST     Comma-separated NASA center codes to restrict to (e.g. KSC,JSC)
  --dry-run          Run discovery + normalize + classify but DO NOT write
                     to inbox.json, state.json, or log/
  -h, --help         Show this help

Outputs:
  tools/import/inbox.json   - candidates pending review (appended)
  tools/import/state.json   - persistent dedup + cursor state (updated)
  tools/import/log/*.log    - per-run summary log

Downloads and image resizing are NOT performed yet. The candidate
image_url field points at the source's original; the admin Pending tab
can render thumbnails directly. A follow-up will add local download +
resize to staging/web/.`);
}

if (require.main === module) {
  main().catch(err => {
    console.error('[sync] FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { main, scoreQuality };

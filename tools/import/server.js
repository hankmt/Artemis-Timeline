#!/usr/bin/env node
/**
 * Local HTTP sidecar for the acquisition pipeline.
 *
 * Bound to 127.0.0.1 only — never exposed beyond loopback. The admin.html
 * Pending tab makes fetch() calls against this server's endpoints while
 * the rest of the static site is served by `python -m http.server` or
 * similar.
 *
 * Endpoints (all return JSON, all accept JSON for POST):
 *
 *   GET  /status          - { lastRunAt, inboxCount, seenCount, rejectedCount }
 *   GET  /inbox           - the current inbox array
 *   POST /promote         - promote a list of candidates to photos.js
 *   POST /reject          - mark a list of candidates as rejected
 *   POST /sync            - run sync.js as a child process
 *
 * Usage:
 *   node tools/import/server.js [--port 8001]
 *
 * The server is intentionally minimal — no auth, no rate limiting, no
 * persistent connections. It exists so admin.html can mutate filesystem-
 * bound state without the user having to drop to a terminal.
 */

'use strict';

const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { URL } = require('url');

const { readPhotosJs, writePhotosJs } = require('./shared/photos-io');
const { isoEdt } = require('./shared/dates');

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const PHOTOS_JS  = path.join(REPO_ROOT, 'photos.js');
const WEB_DIR    = path.join(REPO_ROOT, 'web');
const STATE_JSON = path.join(__dirname, 'state.json');
const INBOX_JSON = path.join(__dirname, 'inbox.json');
const SYNC_JS    = path.join(__dirname, 'sync.js');

const DEFAULT_PORT = 8001;
const BIND_HOST    = '127.0.0.1';

// ---------------------------------------------------------------------------
// JSON file helpers (atomic writes)
// ---------------------------------------------------------------------------

async function loadJsonOr(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tmp = filePath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, filePath);
}

async function loadState() {
  const s = await loadJsonOr(STATE_JSON, {
    seen: [], rejected: [], lastRunAt: null, cursors: {},
  });
  s.seen     = s.seen     || [];
  s.rejected = s.rejected || [];
  s.cursors  = s.cursors  || {};
  return s;
}

async function loadInbox() {
  const i = await loadJsonOr(INBOX_JSON, []);
  return Array.isArray(i) ? i : [];
}

// ---------------------------------------------------------------------------
// HTTP utilities
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  // CORS: allow loopback callers from any port (e.g. python -m http.server :8000).
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendError(res, status, message, detail) {
  sendJson(res, status, { error: message, detail: detail || null });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1024 * 1024) {           // 1 MB safety cap
        req.destroy();
        reject(new Error('request body too large'));
        return;
      }
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!body) { resolve({}); return; }
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('invalid JSON body: ' + e.message)); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Image download + filename derivation for promotion
// ---------------------------------------------------------------------------

/**
 * Sanitize a source_id into a safe filename body. Strip path separators
 * and characters that don't belong in a filename. Keep dots out of the
 * stem so the extension is unambiguous.
 */
function safeFilenameStem(s) {
  return String(s)
    .replace(/[\\/]/g, '_')
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function extensionFromUrl(url) {
  const m = url.match(/\.([a-z0-9]{2,5})(?:\?.*)?$/i);
  if (!m) return 'jpg';
  const ext = m[1].toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(ext)) return ext === 'jpeg' ? 'jpg' : ext;
  return 'jpg';
}

function deriveFilename(candidate) {
  const stem = safeFilenameStem(candidate.source_id || candidate.source + '_unnamed');
  const ext = extensionFromUrl(candidate.image_url || '');
  return `${stem}.${ext}`;
}

/**
 * Download the candidate's image_url to web/<filename>. Streams straight
 * to a temp file, then renames into place. Returns the local filename.
 */
async function downloadImage(candidate) {
  if (!candidate.image_url) throw new Error('candidate has no image_url');
  const filename = deriveFilename(candidate);
  const destPath = path.join(WEB_DIR, filename);
  const tmpPath  = destPath + '.dl-tmp';

  // Refuse to clobber an existing file. If it's already there, assume it's
  // the same image (filename is derived deterministically from source_id)
  // and skip the download.
  try {
    await fs.access(destPath);
    return filename;
  } catch (e) { /* doesn't exist — proceed */ }

  const res = await fetch(candidate.image_url);
  if (!res.ok) {
    throw new Error(`image_url ${candidate.image_url} returned HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.mkdir(WEB_DIR, { recursive: true });
  await fs.writeFile(tmpPath, buffer);
  await fs.rename(tmpPath, destPath);
  return filename;
}

// ---------------------------------------------------------------------------
// Promotion logic: inbox candidate -> photos.js entry
// ---------------------------------------------------------------------------

/**
 * Convert an inbox candidate (plus optional user edits) into a photos.js
 * entry matching Hank's schema convention. The returned object has only
 * the fields that belong in photos.js — internal pipeline fields like
 * _normalized, classified, thumb_url, source_url, image_url, tags are
 * dropped.
 */
function candidateToPhotoEntry(candidate, edits, filename, curator) {
  const e = { ...candidate, ...edits };   // edits override candidate

  // Photos.js fields, in (roughly) Hank's order:
  return {
    time:         e.taken_at || e.time || '',
    file:         filename,
    photographer: e.photographer || 'NASA',
    location:     e.location || '',
    camera:       e.camera || '',
    settings:     e.settings || '',
    spacecraft:   !!e.spacecraft,
    batch:        0,
    title:        e.title || '',
    flickr_desc:  e.description || e.flickr_desc || '',
    enabled:      true,
    // Schema-additions fields:
    addedAt:   isoEdt(),
    source:    candidate.source || 'manual',
    source_id: candidate.source_id || '',
    era:       (e.classified && e.classified.era) || e.era || 'unknown',
    curator:   curator || 'johnmknight',
    center:    e.center || '',
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function routeStatus(req, res) {
  const [state, inbox] = await Promise.all([loadState(), loadInbox()]);
  sendJson(res, 200, {
    ok: true,
    lastRunAt: state.lastRunAt,
    inboxCount: inbox.length,
    seenCount: state.seen.length,
    rejectedCount: state.rejected.length,
  });
}

async function routeInbox(req, res) {
  const inbox = await loadInbox();
  sendJson(res, 200, { ok: true, candidates: inbox });
}

/**
 * POST /promote
 * Body: { items: [{ source_id: "...", edits: { ... }, curator: "..." }, ...] }
 *
 * For each item:
 *   - find candidate in inbox by source_id
 *   - download image_url to web/<derived_filename>
 *   - build photos.js entry, append to PHOTO_DATA.photos
 *   - remove from inbox
 *   - record source_id in state.seen (it stays there anyway from earlier
 *     sync runs, but explicit re-add is safe)
 *
 * Writes inbox.json + photos.js atomically. If any item fails its download
 * the whole batch rolls back (no partial promotion).
 */
async function routePromote(req, res) {
  const body = await readJsonBody(req);
  const items = Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0) {
    return sendError(res, 400, 'body.items required and must be non-empty');
  }

  const [photoData, inbox] = await Promise.all([readPhotosJs(PHOTOS_JS), loadInbox()]);
  const candidateById = new Map(inbox.map(c => [c.source_id, c]));

  // First pass: validate all items
  const plans = [];
  for (const item of items) {
    if (!item.source_id) return sendError(res, 400, 'each item needs source_id');
    const candidate = candidateById.get(item.source_id);
    if (!candidate) return sendError(res, 404, `no inbox candidate ${item.source_id}`);
    plans.push({ candidate, edits: item.edits || {}, curator: item.curator });
  }

  // Second pass: download images for everything before mutating anything.
  // If a download fails, we abort cleanly.
  const downloaded = [];
  try {
    for (const p of plans) {
      const merged = { ...p.candidate, ...p.edits };
      const filename = await downloadImage(merged);
      downloaded.push({ ...p, filename });
    }
  } catch (e) {
    return sendError(res, 502, 'image download failed during promotion', e.message);
  }

  // Third pass: mutate photos.js + inbox atomically
  for (const p of downloaded) {
    const entry = candidateToPhotoEntry(p.candidate, p.edits, p.filename, p.curator);
    photoData.photos.push(entry);
  }
  const remainingInbox = inbox.filter(
    c => !downloaded.some(p => p.candidate.source_id === c.source_id)
  );

  await writePhotosJs(PHOTOS_JS, photoData);
  await writeJsonAtomic(INBOX_JSON, remainingInbox);

  sendJson(res, 200, {
    ok: true,
    promoted: downloaded.length,
    promotedIds: downloaded.map(p => p.candidate.source_id),
    photosCount: photoData.photos.length,
    inboxCount: remainingInbox.length,
  });
}

/**
 * POST /reject
 * Body: { source_ids: ["...", ...], reason: "optional" }
 *
 * Removes the matching candidates from inbox.json and adds their IDs to
 * state.rejected so a future sync run won't re-discover them.
 */
async function routeReject(req, res) {
  const body = await readJsonBody(req);
  const ids = Array.isArray(body.source_ids) ? body.source_ids : null;
  if (!ids || ids.length === 0) {
    return sendError(res, 400, 'body.source_ids required and must be non-empty');
  }

  const [state, inbox] = await Promise.all([loadState(), loadInbox()]);
  const idSet = new Set(ids);
  const removed = inbox.filter(c => idSet.has(c.source_id)).map(c => c.source_id);
  const remaining = inbox.filter(c => !idSet.has(c.source_id));

  for (const id of removed) {
    if (!state.rejected.includes(id)) state.rejected.push(id);
  }

  await writeJsonAtomic(INBOX_JSON, remaining);
  await writeJsonAtomic(STATE_JSON, state);

  sendJson(res, 200, {
    ok: true,
    rejected: removed.length,
    rejectedIds: removed,
    inboxCount: remaining.length,
  });
}

/**
 * POST /sync
 * Body: { query?, centers?, limit?, fullRescan?, source? }
 *
 * Spawns sync.js as a child process with the given options. Waits for it
 * to complete (sync runs are typically a few seconds to a minute) then
 * returns the run summary plus the new inbox count.
 *
 * For long-running syncs the client should still call this endpoint —
 * we keep the connection open until the child exits. A future revision
 * can switch to a streaming or polling protocol if runs get slow enough
 * to matter.
 */
async function routeSync(req, res) {
  const body = await readJsonBody(req);

  const args = [SYNC_JS];
  if (body.limit)       args.push('--limit', String(body.limit | 0));
  if (body.fullRescan)  args.push('--full-rescan');
  if (body.source)      args.push('--source', String(body.source));
  if (body.query)       args.push('--query', String(body.query));
  if (Array.isArray(body.centers) && body.centers.length) {
    args.push('--centers', body.centers.join(','));
  }

  const child = spawn(process.execPath, args, { cwd: REPO_ROOT });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => stderr += d.toString());

  child.on('close', async (code) => {
    const inbox = await loadInbox();
    const status = code === 0 ? 200 : 500;
    sendJson(res, status, {
      ok: code === 0,
      exitCode: code,
      stdout,
      stderr,
      inboxCount: inbox.length,
    });
  });
  child.on('error', err => {
    sendError(res, 500, 'sync child process failed to start', err.message);
  });
}

// ---------------------------------------------------------------------------
// Server bootstrap
// ---------------------------------------------------------------------------

function dispatch(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const route = req.method + ' ' + url.pathname;

  // Route table. Each handler returns a Promise we catch at the bottom.
  const routes = {
    'GET /status':   routeStatus,
    'GET /inbox':    routeInbox,
    'POST /promote': routePromote,
    'POST /reject':  routeReject,
    'POST /sync':    routeSync,
  };

  const handler = routes[route];
  if (!handler) {
    return sendError(res, 404, `no route ${route}`);
  }

  Promise.resolve(handler(req, res)).catch(err => {
    console.error(`[server] ${route} failed:`, err);
    if (!res.headersSent) sendError(res, 500, err.message);
  });
}

function parseArgs(argv) {
  const args = { port: DEFAULT_PORT };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = parseInt(argv[++i], 10) || DEFAULT_PORT;
    else if (argv[i] === '-h' || argv[i] === '--help') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`Usage: node tools/import/server.js [options]

Options:
  --port N    Bind port (default ${DEFAULT_PORT})
  -h         Show this help

The server binds to 127.0.0.1 only. It exposes the acquisition
pipeline's state to the admin Pending tab and accepts mutations
(promote / reject / sync).`);
}

function start() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }

  const server = http.createServer(dispatch);
  server.listen(args.port, BIND_HOST, () => {
    console.log(`[server] listening on http://${BIND_HOST}:${args.port}`);
    console.log(`[server] routes:`);
    console.log(`           GET  /status`);
    console.log(`           GET  /inbox`);
    console.log(`           POST /promote`);
    console.log(`           POST /reject`);
    console.log(`           POST /sync`);
    console.log(`[server] press Ctrl-C to stop`);
  });

  process.on('SIGINT',  () => { console.log('\n[server] shutting down'); server.close(() => process.exit(0)); });
  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
}

if (require.main === module) {
  start();
}

module.exports = { start, dispatch };

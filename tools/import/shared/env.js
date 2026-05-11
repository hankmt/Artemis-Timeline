/**
 * Tiny .env-style credential loader for the acquisition pipeline.
 *
 * We don't want secrets in tracked files (this is exactly what got the
 * legacy fetch-flickr-descriptions.js key revoked), so credentials live
 * in `tools/import/.env.local` which is gitignored via the `*.local`
 * pattern in .gitignore.
 *
 * File format (one assignment per line, very small subset of .env spec):
 *
 *   # comments start with #
 *   KEY=value
 *   QUOTED="value with spaces"
 *
 * Lookup order: process.env first, then .env.local.
 *
 * Returns null if the credential isn't found anywhere — callers should
 * decide whether that's a hard error or a "skip this adapter" condition.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ENV_PATH = path.join(__dirname, '..', '.env.local');

let cachedEnv = null;
let cachedPath = null;

function parseEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, 'utf8');
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip matched surrounding quotes
    if (val.length >= 2 &&
        ((val.startsWith('"') && val.endsWith('"')) ||
         (val.startsWith("'") && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function loadEnv(envPath) {
  envPath = envPath || DEFAULT_ENV_PATH;
  if (cachedEnv && cachedPath === envPath) return cachedEnv;
  cachedEnv = parseEnvFile(envPath);
  cachedPath = envPath;
  return cachedEnv;
}

/**
 * Get a credential by name. Process env takes priority over the .env.local
 * file. Returns null if absent.
 *
 * @param {string} name
 * @param {string} [envPath]  optional override for .env.local location
 * @returns {string|null}
 */
function getCredential(name, envPath) {
  if (process.env[name]) return process.env[name];
  const env = loadEnv(envPath);
  return env[name] || null;
}

/**
 * Get a credential or throw if missing. Useful for adapters that can't
 * function at all without their key.
 */
function requireCredential(name, envPath) {
  const v = getCredential(name, envPath);
  if (!v) {
    throw new Error(
      `Missing required credential ${name}. Add it to tools/import/.env.local or set the env var.`
    );
  }
  return v;
}

module.exports = { getCredential, requireCredential, loadEnv };

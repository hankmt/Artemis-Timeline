/**
 * Read and write the canonical `photos.js` data file.
 *
 * `photos.js` is a tiny wrapper around a JSON-shaped object:
 *
 *     const PHOTO_DATA = { "photos": [...], "audio": [...] };
 *
 * Hank's admin.html emits this via `JSON.stringify(data, null, 2)` and
 * prepends the `const ...=` wrapper, so the body is reliably clean JSON.
 * We rely on that assumption when parsing here. If anyone hand-edits the
 * file with JS-specific syntax (comments, trailing commas, single quotes),
 * this loader will fail; the caller should propagate that error clearly
 * rather than silently fall back.
 *
 * Writes are atomic: serialize → write to `<path>.tmp` → fsync → rename.
 * On Windows the rename is also atomic when the target exists, but only
 * if the temp file is on the same volume — which it always is since we
 * write next to the original.
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');

const WRAPPER_PREFIX = 'const PHOTO_DATA = ';
const WRAPPER_SUFFIX = ';\n';

/**
 * Read `photos.js` from disk and return the parsed PHOTO_DATA object.
 *
 * @param {string} photosJsPath - absolute path to photos.js
 * @returns {Promise<{photos: object[], audio: object[]}>}
 */
async function readPhotosJs(photosJsPath) {
  const raw = await fs.readFile(photosJsPath, 'utf8');
  const trimmed = raw.trim();

  if (!trimmed.startsWith('const PHOTO_DATA')) {
    throw new Error(
      `photos.js does not start with "const PHOTO_DATA" — got: ${trimmed.slice(0, 60)}...`
    );
  }

  // Strip "const PHOTO_DATA = " (with or without surrounding whitespace)
  // and the trailing semicolon. What remains should be parseable JSON.
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx < 0) {
    throw new Error('photos.js missing "=" after "const PHOTO_DATA"');
  }
  let body = trimmed.slice(eqIdx + 1).trim();
  if (body.endsWith(';')) body = body.slice(0, -1).trim();

  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`photos.js body is not valid JSON: ${err.message}`);
  }
}

/**
 * Serialize a PHOTO_DATA object and write it to disk atomically.
 *
 * @param {string} photosJsPath - absolute path to photos.js
 * @param {object} data - the PHOTO_DATA object to write
 */
async function writePhotosJs(photosJsPath, data) {
  const json = JSON.stringify(data, null, 2);
  const content = WRAPPER_PREFIX + json + WRAPPER_SUFFIX;

  const tmpPath = photosJsPath + '.tmp';
  // Write + fsync to make the durability/atomicity story honest on crash.
  const fh = await fs.open(tmpPath, 'w');
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  // rename() is atomic on POSIX and on Windows when src+dst are on the
  // same volume (which they always are here).
  await fs.rename(tmpPath, photosJsPath);
}

/**
 * Append photo entries to PHOTO_DATA and write the result. Convenience
 * wrapper around readPhotosJs + writePhotosJs.
 *
 * Caller is responsible for ensuring entries are unique (no dedup here).
 *
 * @param {string} photosJsPath
 * @param {object[]} newPhotos
 * @returns {Promise<number>} new total photo count
 */
async function appendPhotos(photosJsPath, newPhotos) {
  const data = await readPhotosJs(photosJsPath);
  data.photos = data.photos.concat(newPhotos);
  await writePhotosJs(photosJsPath, data);
  return data.photos.length;
}

module.exports = {
  readPhotosJs,
  writePhotosJs,
  appendPhotos,
};

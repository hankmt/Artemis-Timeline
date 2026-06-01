/**
 * EDT timestamp parsing and formatting.
 *
 * The Artemis Timeline app stores every timestamp as a "YYYY-MM-DD HH:MM:SS"
 * string in Eastern Daylight Time (UTC-4). This module is the Node-side
 * mirror of the inline helpers in index.html — viewer keeps its own copies
 * because the index.html file is meant to remain self-contained.
 *
 * Why EDT specifically: the mission window (April 1-10, 2026) lies entirely
 * within EDT (no spring-forward / fall-back boundary). For Artemis II all
 * times happen to also be EDT. If you ever need to support mission events
 * spanning a DST boundary, this module will need to change.
 */

'use strict';

const MS_PER_HOUR = 3600 * 1000;
const EDT_OFFSET_MS = -4 * MS_PER_HOUR;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Parse a "YYYY-MM-DD HH:MM:SS" EDT string into Unix milliseconds.
 *
 * @param {string} s
 * @returns {number} milliseconds since epoch
 */
function edt(s) {
  return new Date(s.replace(' ', 'T') + '-04:00').getTime();
}

/**
 * Decompose a Unix-ms timestamp into EDT date/time parts.
 *
 * Trick: shift the timestamp by -4h, then read the UTC accessors of the
 * resulting Date. The UTC values are now the EDT-local values. Avoids the
 * browser-dependent behaviour of Date.toLocaleString.
 *
 * @param {number} ts
 * @returns {{mon: string, day: string, dayNum: number, hr24: number,
 *           hr: number, min: string, sec: string, ampm: string}}
 */
function edtParts(ts) {
  const d = new Date(ts + EDT_OFFSET_MS);
  return {
    mon:    MONTHS[d.getUTCMonth()],
    day:    String(d.getUTCDate()).padStart(2, '0'),
    dayNum: d.getUTCDate(),
    hr24:   d.getUTCHours(),
    hr:     d.getUTCHours() % 12 || 12,
    min:    String(d.getUTCMinutes()).padStart(2, '0'),
    sec:    String(d.getUTCSeconds()).padStart(2, '0'),
    ampm:   d.getUTCHours() < 12 ? 'AM' : 'PM'
  };
}

/**
 * Format an EDT timestamp as "Apr 01, 6:35:25 PM".
 */
function formatTime(ts) {
  const p = edtParts(ts);
  return `${p.mon} ${p.day}, ${p.hr}:${p.min}:${p.sec} ${p.ampm}`;
}

/**
 * Format an EDT timestamp as "Apr 1, 6:35 PM".
 */
function formatTimeShort(ts) {
  const p = edtParts(ts);
  return `${p.mon} ${p.dayNum}, ${p.hr}:${p.min} ${p.ampm}`;
}

/**
 * Convert a Unix-ms timestamp into the "YYYY-MM-DD HH:MM:SS" EDT string
 * format used inside photos.js.
 *
 * @param {number} ts
 * @returns {string}
 */
function toPhotosTime(ts) {
  const d = new Date(ts + EDT_OFFSET_MS);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hr = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const se = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${day} ${hr}:${mi}:${se}`;
}

/**
 * Produce an ISO-8601 timestamp string in EDT (UTC-04:00).
 * Used for the `addedAt` schema field on photo entries.
 *
 * @param {Date} [d] — defaults to "now"
 * @returns {string}
 */
function isoEdt(d) {
  d = d || new Date();
  const shifted = new Date(d.getTime() + EDT_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const mo = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hr = String(shifted.getUTCHours()).padStart(2, '0');
  const mi = String(shifted.getUTCMinutes()).padStart(2, '0');
  const se = String(shifted.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${day}T${hr}:${mi}:${se}-04:00`;
}

module.exports = {
  edt,
  edtParts,
  formatTime,
  formatTimeShort,
  toPhotosTime,
  isoEdt,
};

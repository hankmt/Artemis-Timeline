/**
 * Candidate normalizers.
 *
 * These run after a source adapter returns candidates but before the
 * classifier sees them. The goal is to bring source-specific quirks into
 * line with Hank's existing photos.js conventions so the downstream
 * classifier, admin UI, and viewer all see consistent data.
 *
 * Two normalizers right now:
 *
 *   normalizePhotographer  - convert source-specific photographer credit
 *                            formats into Hank's canonical "NASA/First Last"
 *                            shape (or "NASA" when only the affiliation is known).
 *   normalizeTimestamp     - replace "fake-precise" timestamps (a source's
 *                            midnight-UTC date_created that happens to convert
 *                            to 20:00:00 EDT) with an honest noon-EDT
 *                            placeholder. Per EDITORIAL.md: never invent
 *                            precision.
 *
 * Each normalizer is pure (input → output) and side-effect-free.
 */

'use strict';

/**
 * Convert various photographer-credit formats into "NASA/First Last"
 * canonical form.
 *
 * Examples in:
 *   "ROBERT MARKOWITZ  NASA-JSC"       → "NASA/Robert Markowitz"
 *   "James Blair - NASA - JSC"         → "NASA/James Blair"
 *   "NASA/Joel Kowsky"                 → "NASA/Joel Kowsky" (passthrough)
 *   "NASA"                             → "NASA"
 *   "" / null / undefined              → "NASA"
 *   "Aubrey Gemignani"                 → "NASA/Aubrey Gemignani" (assumed NASA
 *                                        when affiliation not stated; safe
 *                                        for Artemis II since all our sources
 *                                        are NASA-derived)
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizePhotographer(raw) {
  if (raw === null || raw === undefined) return 'NASA';
  let s = String(raw).trim();
  if (!s) return 'NASA';

  // Already canonical "NASA/Name" — keep as-is (just clean whitespace).
  if (/^NASA\/[^ ].*/i.test(s)) {
    return s.replace(/^NASA\/\s*/i, 'NASA/').replace(/\s+/g, ' ');
  }

  // Plain "NASA" or "NASA-JSC" / "NASA / JSC" → just "NASA"
  if (/^NASA([-\s\/]+[A-Z]{2,5})?$/i.test(s)) return 'NASA';

  // Strip trailing/leading NASA affiliation markers in any common form.
  //   "ROBERT MARKOWITZ  NASA-JSC"
  //   "James Blair - NASA - JSC"
  //   "Aubrey Gemignani / NASA"
  //   "Bill Ingalls (NASA)"
  // Handle "(NASA)" as a whole token first so we don't leave a stray
  // closing paren behind.
  s = s.replace(/[\s,]*\(NASA[\s\/-]*[A-Z]{0,5}\)[\s,]*/gi, ' ');
  s = s.replace(/[\s,()\/-]*NASA[\s,()\/-]*[A-Z]{2,5}\b/gi, '');   // "NASA-JSC" etc.
  s = s.replace(/[\s,()\/-]+NASA\b/gi, '');                          // trailing/embedded NASA

  // Collapse whitespace, strip orphaned separators.
  s = s.replace(/\s+/g, ' ').replace(/^[\s,()\/-]+|[\s,()\/-]+$/g, '').trim();
  if (!s) return 'NASA';

  // Title-case the name. We use a simple per-word capitalize that handles
  // common surname patterns (Mc, Mac, O'Brien, De La Vega) reasonably well.
  s = titleCaseName(s);

  return 'NASA/' + s;
}

function titleCaseName(s) {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, c => c.toUpperCase())
    .replace(/\b(Mc|Mac)([a-z])/g, (m, p, c) => p + c.toUpperCase())
    .replace(/'([a-z])/g, (m, c) => "'" + c.toUpperCase());
}

/**
 * Apply the honest-timestamp policy. If a timestamp's time-of-day is a
 * known "fake precision" sentinel (00:00:00 UTC → 20:00:00 EDT, or already
 * 00:00:00 EDT), replace it with 12:00:00 EDT and signal that this is a
 * date-only entry to the caller.
 *
 * Returns { time, datePrecisionOnly }.
 *
 *   "2024-07-15 20:00:00"    → { time: "2024-07-15 12:00:00", datePrecisionOnly: true }
 *   "2024-07-15 00:00:00"    → { time: "2024-07-15 12:00:00", datePrecisionOnly: true }
 *   "2024-07-15 13:42:07"    → { time: "2024-07-15 13:42:07", datePrecisionOnly: false }
 *   ""                       → { time: "",                     datePrecisionOnly: false }
 *
 * @param {string} timeStr  "YYYY-MM-DD HH:MM:SS" format, EDT
 * @returns {{time: string, datePrecisionOnly: boolean}}
 */
function normalizeTimestamp(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    return { time: '', datePrecisionOnly: false };
  }
  const m = timeStr.match(/^(\d{4}-\d{2}-\d{2})\s(\d{2}:\d{2}:\d{2})$/);
  if (!m) return { time: timeStr, datePrecisionOnly: false };

  const datePart = m[1];
  const timePart = m[2];

  // Sentinel times that signal "date is reliable; time is a placeholder":
  //   00:00:00 — caller already in EDT-input
  //   20:00:00 — UTC midnight converted to EDT
  if (timePart === '00:00:00' || timePart === '20:00:00') {
    return { time: `${datePart} 12:00:00`, datePrecisionOnly: true };
  }
  return { time: timeStr, datePrecisionOnly: false };
}

/**
 * Apply all normalizers to a candidate. Returns a new candidate object;
 * does not mutate the input. Adds a `_normalized` debug field tracking
 * which normalizers fired (useful for the admin Pending tab to surface
 * "this was a date-only entry — set the time before promoting").
 *
 * @param {object} candidate
 * @returns {object}
 */
function normalizeCandidate(candidate) {
  const photographer = normalizePhotographer(candidate.photographer);
  const tsResult = normalizeTimestamp(candidate.taken_at);

  return {
    ...candidate,
    photographer,
    taken_at: tsResult.time,
    _normalized: {
      photographerChanged: photographer !== candidate.photographer,
      datePrecisionOnly: tsResult.datePrecisionOnly,
    },
  };
}

module.exports = {
  normalizePhotographer,
  normalizeTimestamp,
  normalizeCandidate,
};

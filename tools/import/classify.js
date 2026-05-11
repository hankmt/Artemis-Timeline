/**
 * Keyword-based era classifier.
 *
 * Takes a normalized Candidate and returns:
 *   { era, confidence, subject_tags, reason }
 *
 * Layered logic per DESIGN.md:
 *   1. Date window  — taken_at within Apr 1–11 2026 → "mission" (high)
 *   2. Source default — adapter's baseline era guess, if any
 *   3. Keyword scan — regex matches on title + description + tags
 *   4. Combine — high if multiple signals agree, medium if only one,
 *                low/unknown if nothing matches.
 *
 * The whole module is pure (input → output), no side effects, no I/O.
 * A future revision could swap the keyword regex for a Claude API call
 * and the rest of the pipeline wouldn't notice.
 */

'use strict';

const ERA_PRE_HARDWARE = 'pre-flight-hardware';
const ERA_PRE_TRAINING = 'pre-flight-training';
const ERA_MISSION      = 'mission';
const ERA_POST_MISSION = 'post-mission';
const ERA_UNKNOWN      = 'unknown';

// Mission window matches Hank's curated narrative — covers his actual span
// (March 27 through April 11, 2026). Liftoff was Apr 1 18:35:25 EDT.
const MISSION_START_DATE = '2026-03-27';
const MISSION_END_DATE   = '2026-04-11';

/**
 * Per-era keyword patterns. Order within each list doesn't matter; we
 * only count "did any pattern match?" Patterns are case-insensitive and
 * use word-boundaries where possible to avoid false positives (e.g. we
 * don't want "training" inside "intraining" to match).
 */
const KEYWORDS = {
  [ERA_PRE_HARDWARE]: [
    /\bcore stage\b/i,
    /\bRS-25\b/i,
    /\bengine test\b/i,
    /\bgreen run\b/i,
    /\bwet dress\b/i,
    /\bstennis\b/i,
    /\bmichoud\b/i,
    /\bMSFC\b/i,
    /\bmarshall space\b/i,
    /\bSLS\b/i,
    /\bspace launch system\b/i,
    /\bsolid rocket booster\b/i,
    /\bSRB\b/i,
    /\bservice module\b/i,
    /\bcrew module\b/i,
    /\bmobile launcher\b/i,
    /\bumbilical\b/i,
    /\bVAB\b/i,
    /\bvehicle assembly building\b/i,
    /\brollout\b/i,
    /\bintegration\b/i,
    /\bpad 39B\b/i,
    /\blaunch pad\b/i,
    /\blockheed\b/i,
    /\bnorthrop\b/i,
    /\bboeing/i,
  ],
  [ERA_PRE_TRAINING]: [
    /\bNBL\b/i,
    /\bneutral buoyancy lab\b/i,
    /\bT-38\b/i,
    /\bsimulator\b/i,
    /\bsimulation\b/i,
    /\bsuit fit\b/i,
    /\bOCSS\b/i,
    /\bsurvival training\b/i,
    /\bparabolic flight\b/i,
    /\bzero[\s-]?g\b/i,
    /\bcentrifuge\b/i,
    /\bEVA training\b/i,
    /\bmission rehearsal\b/i,
    /\bgeology training\b/i,
    /\blunar observ/i,
    /\bcrew training\b/i,
    /\btraining session\b/i,
    /\bbriefing\b/i,
    /\bORION mockup\b/i,
    /\bspace vehicle mockup\b/i,
  ],
  [ERA_MISSION]: [
    /\bliftoff\b/i,
    /\blaunch\s*(day|sequence)?\b/i,
    /\bsplashdown\b/i,
    /\blunar flyby\b/i,
    /\bTLI\b/i,
    /\btrans[\s-]?lunar injection\b/i,
    /\bin[\s-]?flight\b/i,
    /\bin\s*space\b/i,
    /\bcrew walkout\b/i,
    /\bsuit[\s-]?up\b/i,
    /\bO&C building\b/i,
    /\bOperations and Checkout\b/i,
    /\barmstrong operations\b/i,
  ],
  [ERA_POST_MISSION]: [
    /\brecovery operation\b/i,
    /\bcrew debrief\b/i,
    /\bpost[\s-]?flight\b/i,
    /\bwelcome home\b/i,
    /\bdebrief\b/i,
    /\bUSS John P\.? Murtha\b/i,
  ],
};

/**
 * Decide era from the candidate's date alone.
 * Returns one of the era constants, or null when the date isn't usable.
 */
function dateBasedEra(takenAt) {
  if (!takenAt || typeof takenAt !== 'string') return null;
  // Compare just the YYYY-MM-DD portion via lexicographic order (works
  // because the format is sortable).
  const datePart = takenAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  if (datePart >= MISSION_START_DATE && datePart <= MISSION_END_DATE) {
    return ERA_MISSION;
  }
  if (datePart > MISSION_END_DATE) {
    return ERA_POST_MISSION;
  }
  return null; // before mission window — could be hardware or training; let
               // keyword scan decide
}

/**
 * Run all keyword patterns against a set of named source fields. Each
 * field is scanned independently so we can tell the reviewer which field
 * a match came from (title vs description vs tags).
 *
 * Returns:
 *   - matches[]: every pattern hit, with the matched text and where it
 *                lives. One match record per regex hit (so the same
 *                pattern matching twice in one field produces two records).
 *   - hits: { era → count } total across all fields.
 *   - keywordEra: era with the most hits (KEYWORDS declaration order
 *                  for ties).
 *   - matchCount: hits[keywordEra].
 *
 * A `match` record looks like:
 *   { kind: "keyword",
 *     pattern: "\\bgeology training\\b",  // regex source for display
 *     excerpt: "geology training",          // actual matched substring
 *     era: "pre-flight-training",
 *     sourceField: "title" | "description" | "tags",
 *     index: 14                              // start index in the field text
 *   }
 *
 * This shape was chosen for forward-compatibility with an LLM classifier
 * that would return `{ kind: "rationale", text, era }` records instead.
 * Renderers should switch on `kind`.
 */
function scanKeywords(fields) {
  const hits = {};
  for (const era of Object.keys(KEYWORDS)) hits[era] = 0;
  const matches = [];

  if (!fields || typeof fields !== 'object') {
    return { keywordEra: null, matchCount: 0, hits, matches };
  }

  for (const [sourceField, fieldText] of Object.entries(fields)) {
    if (!fieldText) continue;
    for (const [era, patterns] of Object.entries(KEYWORDS)) {
      for (const re of patterns) {
        // Use a fresh global-flag regex so .exec() can iterate multiple hits
        // without mutating the original pattern's lastIndex.
        const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
        let m;
        while ((m = g.exec(fieldText)) !== null) {
          hits[era]++;
          matches.push({
            kind: 'keyword',
            pattern: re.source,
            excerpt: m[0],
            era,
            sourceField,
            index: m.index,
          });
          // Prevent zero-length-match infinite loop (paranoia).
          if (m.index === g.lastIndex) g.lastIndex++;
        }
      }
    }
  }

  // Tie-breaking: KEYWORDS declaration order.
  let bestEra = null;
  let bestCount = 0;
  for (const era of Object.keys(KEYWORDS)) {
    if (hits[era] > bestCount) {
      bestEra = era;
      bestCount = hits[era];
    }
  }
  return { keywordEra: bestEra, matchCount: bestCount, hits, matches };
}

/**
 * Extract subject tags from a text blob — every keyword bucket that had
 * any hits becomes a tag. Useful for the admin Pending tab to show "this
 * looked like hardware AND mission" when keyword signals are mixed.
 */
function extractSubjectTags(hits) {
  return Object.keys(hits).filter(era => hits[era] > 0);
}

/**
 * Build the named field map the classifier scans. Keeping fields separate
 * (vs. one concatenated blob) lets the highlighter tell the reviewer
 * which field a match came from.
 */
function candidateFields(candidate) {
  return {
    title: candidate.title || '',
    description: candidate.description || '',
    tags: Array.isArray(candidate.tags) ? candidate.tags.join(' • ') : '',
  };
}

/**
 * Classify a candidate. Pure function.
 *
 * @param {object} candidate
 * @returns {{era: string, confidence: 'high'|'medium'|'low',
 *            subject_tags: string[], reason: string}}
 */
function classify(candidate) {
  const sourceDefault = candidate.source_default_era || ERA_UNKNOWN;
  const dateBased = dateBasedEra(candidate.taken_at);
  const fields = candidateFields(candidate);
  const { keywordEra, matchCount, hits, matches } = scanKeywords(fields);

  let era, confidence, reason;

  // Strongest signal: a date in the mission window. Trust it absolutely —
  // Hank's mission curation includes pre-launch days (March 27+).
  if (dateBased === ERA_MISSION) {
    era = ERA_MISSION;
    confidence = 'high';
    reason = 'date in mission window';

  // Two corroborating signals: keyword AND source-default agree.
  } else if (keywordEra && sourceDefault !== ERA_UNKNOWN && keywordEra === sourceDefault) {
    era = keywordEra;
    confidence = 'high';
    reason = 'source default + keywords agree';

  // Date past mission window with mission-related keywords → post-mission.
  } else if (dateBased === ERA_POST_MISSION && keywordEra === ERA_POST_MISSION) {
    era = ERA_POST_MISSION;
    confidence = 'high';
    reason = 'post-mission date + keywords';

  // Strong keyword match (2+ hits) — likely correct.
  } else if (keywordEra && matchCount >= 2) {
    era = keywordEra;
    confidence = 'high';
    reason = `${matchCount} keyword matches`;

  // Single keyword match — possibly right, possibly noise.
  } else if (keywordEra) {
    era = keywordEra;
    confidence = 'medium';
    reason = '1 keyword match';

  // Date-only signal — post-mission edge case (no keyword corroboration).
  } else if (dateBased === ERA_POST_MISSION) {
    era = ERA_POST_MISSION;
    confidence = 'medium';
    reason = 'date past mission window';

  // Source default as fallback.
  } else if (sourceDefault !== ERA_UNKNOWN) {
    era = sourceDefault;
    confidence = 'medium';
    reason = 'source default';

  // Nothing matched.
  } else {
    era = ERA_UNKNOWN;
    confidence = 'low';
    reason = 'no signals';
  }

  // Evidence: enumerate the matches that drove the verdict, plus any
  // structural signals (date window, source default) that contributed.
  // The shape is extensible — quality-score and center-source evidence
  // is attached later by sync.js, and a future LLM classifier can return
  // { kind: "rationale", text, era } records here instead.
  const evidence = {
    era_matches: matches.slice(),
  };
  if (dateBased) {
    evidence.era_matches.push({
      kind: 'date_window',
      pattern: `taken_at in ${MISSION_START_DATE}..${MISSION_END_DATE}`,
      excerpt: candidate.taken_at || '',
      era: dateBased,
      sourceField: 'taken_at',
    });
  }
  if (sourceDefault !== ERA_UNKNOWN) {
    evidence.era_matches.push({
      kind: 'source_default',
      pattern: `${candidate.source} → ${sourceDefault}`,
      excerpt: candidate.source || '',
      era: sourceDefault,
      sourceField: 'source',
    });
  }

  return {
    era,
    confidence,
    subject_tags: extractSubjectTags(hits),
    reason,
    evidence,
  };
}

module.exports = {
  classify,
  // Exported for tests / inspection:
  dateBasedEra,
  scanKeywords,
  KEYWORDS,
  ERA_PRE_HARDWARE,
  ERA_PRE_TRAINING,
  ERA_MISSION,
  ERA_POST_MISSION,
  ERA_UNKNOWN,
};

# Editorial Principles

What makes a candidate photo worth promoting into `photos.js`.

The Artemis Timeline is a **curated** collection, not a comprehensive
archive. Hank's upstream 519 entries are the editorial baseline. New
entries from the sync pipeline have to meet the same bar — that's the
whole point of the `admin.html` Pending review step.

This document is referenced from the Pending tab UI, so a reviewer is
always one click away from the rules.

## Mission

Help a curious viewer follow the Artemis II mission as a story across
time and space. The collection should:

- Be **chronologically continuous** — minimize unexplained gaps in coverage
- Be **photographically meaningful** — favor images that show people doing
  things, hardware in context, or vantage points only this mission offers
- Be **honest** — include moments of difficulty, failure, and quiet routine
  alongside the heroic ones; don't only show the highlight reel
- Be **factually rigorous** — every entry's metadata should be verifiable
  against an authoritative source (NASA, photographer credit, mission log)

## Inclusion checklist

A candidate should be promoted only if it meets these criteria.

### Must have

- [ ] **It's actually Artemis II.** Not Artemis I, Artemis III, Apollo,
  Commercial Crew, or generic SLS stock art. When loose API queries return
  adjacent missions, reject.
- [ ] **A meaningful title.** Not a filename, not "Untitled," not just the
  date. The title is what shows in the viewer's metadata panel and in
  shared link previews — it has to read.
- [ ] **A defensible timestamp.** To the minute when known, to the day when
  not. If the source provides no time, you have to research and assign one
  before promoting. Photos with no resolvable date go in the reject pile.
- [ ] **A photographer credit.** "NASA" is acceptable as a fallback when
  the specific photographer is unknown. Never invent a name.
- [ ] **A description.** At minimum, a sentence longer than the title. The
  description is where context lives — facility name, what's happening in
  the frame, what came before / after.
- [ ] **An era classification.** One of `pre-flight-hardware`,
  `pre-flight-training`, `mission`, or `post-mission`. The classifier
  proposes one; you override if it's wrong.

### Should have

- Source URL pointing to the original (so a reader can verify or get a
  larger version)
- Camera + lens + exposure settings, when EXIF or source metadata provides
  them (matches the level of detail in Hank's existing entries)
- Location (facility name and city when relevant — "NASA Stennis Space
  Center, MS" is better than just "NASA")
- Subject tags (helpful for future facets — e.g., `["RS-25", "engine test",
  "Stennis"]`)

## Rejection criteria

Reject without guilt when:

- The image isn't Artemis II. Boundary cases (Artemis I imagery occasionally
  shows up in Artemis II searches) → reject; lean restrictive.
- It's an **artist's concept**, **CGI render**, or **diagram** rather than
  a photograph. The collection is photographic.
- It's a **logo, mission patch, or graphic** with no photographic content.
- The image is a **near-duplicate** of an existing entry — same scene from
  the same camera within seconds. Pick the best of a burst, reject the rest.
- The description is **substantially incorrect** and you can't fix it. A
  vague description is workable; a wrong one is worse than nothing.
- It's **watermarked**, **low-resolution**, or **clearly a thumbnail** when
  a better version exists at the source.
- The **photographer or rights are unclear** in a way that makes inclusion
  risky. Hank's collection avoids privately-copyrighted material; ours
  should too.

## Field-by-field standards

### `title`
Descriptive, declarative, no clickbait. Match the tone of Hank's existing
titles — "Christina Koch Smiles Before Launch," "Crew Walkout From the O&C
Building," "SLS Glows at Sunset on Pad 39B." If the title is the same as
the description, consolidate them.

### `time`
EDT, "YYYY-MM-DD HH:MM:SS." If only a date is known, use noon EDT
("12:00:00") as a defensible midpoint and note the imprecision in the
description ("approximately mid-afternoon"). Never invent precision.

For mission-week photos, cross-reference against known events (liftoff
2026-04-01 18:35:25, splashdown 2026-04-10 20:07:27). For pre-flight
hardware/training photos, the source's EXIF or caption date is usually
correct.

### `photographer`
Format: `"NASA/<Photographer Name>"` for credited NASA photographers
(matching Hank's convention). `"NASA"` for uncredited. For non-NASA
sources, include the affiliation: `"Lockheed Martin/<Name>"`, `"USCG/<Name>"`,
`"Boeing"`.

### `location`
Specific enough to mean something. "Kennedy Space Center" is fine when
the building isn't known; "Neil Armstrong Operations and Checkout Building,
Kennedy Space Center" is better when it is. Use the facility's preferred
name (NASA generally provides this).

### `camera` and `settings`
Copy verbatim from EXIF when available. Don't infer.

### `description` / `flickr_desc`
Two to four sentences. What's in the frame, what's happening, why it
matters in the mission narrative. Don't recap the title. Don't editorialize.
Match the level of detail Hank brings — informative but not exhaustive.

### `era`
- `pre-flight-hardware` — SLS / Orion / facility / integration / pad ops
  before launch
- `pre-flight-training` — crew training, simulators, suit fit, T-38, NBL,
  briefings
- `mission` — Apr 1–11, 2026 (Hank's curated window)
- `post-mission` — recovery, debrief, post-flight events tied specifically
  to Artemis II

When in doubt between two adjacent eras, prefer the more specific one.
A training event held during mission week is still `pre-flight-training`
in spirit, but you'll find vanishingly few of these.

### `curator`
Auto-set by the sync pipeline to the GitHub handle doing the promotion.
Never edit manually — this field is the editorial signature.

## Ambiguity rules

- **Artemis II vs. another Artemis mission** → lean reject. Artemis II is
  specifically the second crewed mission with Wiseman / Glover / Koch /
  Hansen.
- **Crew portrait vs. publicity shot** → both included, but tagged
  honestly (the era stays the same; the description should make the
  context clear).
- **Hardware photo with no specific people in frame** → fine. Hank's
  collection includes plenty of empty-spacecraft shots.
- **Photo containing the SLS but the subject is something else** → judge
  by intent. A T-shirt in the gift shop with an SLS print on it: reject.
  The SLS rolling past a palm tree on transport: include.
- **Date is "circa 2024" with no month** → either research it to better
  precision or skip. Better to wait than fudge.

## Crew anonymity caveat

Per the FAQ, the four Artemis II astronauts collectively asked not to be
individually credited as photographers for in-mission photos they took.
**Don't attribute specific in-flight photos to a single astronaut even if
EXIF or social media suggests it.** Use `"Artemis II Crew"` as the
photographer for any photo taken from inside the spacecraft, unless
NASA's caption specifically credits the person.

This applies to:
- Photos with `spacecraft: true`
- Photos clearly taken from inside Orion during mission week
- Photos credited to specific astronauts on Flickr/social posts that don't
  also have a NASA HQ caption

Ground photos with NASA-issued photographer credits (KSC, NHQ, JSC) are
fine to attribute normally.

## Voice & style

- **Factual.** State what's in the frame. Avoid editorial adjectives
  ("breathtaking," "stunning," "historic" — those are for the reader to
  decide).
- **Conversational where Hank is conversational.** Match the existing
  prose. If Hank wrote "the crew rides the elevator," don't write "the
  crewmembers utilized the conveyance mechanism."
- **No political framing.** The collection is about a space mission. Keep
  it about the mission. References to broader political context belong in
  the FAQ, not photo descriptions.
- **Active voice.** "Reid Wiseman boards the spacecraft" is better than
  "The spacecraft is boarded by Reid Wiseman."

## Voice — when to override the classifier

The keyword classifier will be wrong sometimes. Trust your eye over its
verdict. Common errors to watch for:

- Tagged `pre-flight-hardware` because the caption mentions "SLS" but the
  subject is actually a crew member at a press event with a model SLS
  behind them → re-tag `pre-flight-training` or `mission`
- Tagged `mission` because the date falls in early April 2026 but the
  subject is actually post-flight debrief → re-tag `post-mission`
- Tagged `unknown` because the caption is empty but the filename or
  visual context makes the era obvious → tag it manually with high
  confidence

## When in doubt

If you're not sure whether to promote a candidate:

1. **Reject it.** A passed-over photo can be re-discovered on the next
   sync; a bad promotion has to be hand-cleaned out of `photos.js`.
2. Note your reasoning in the rejection (the sidecar's `/reject` endpoint
   accepts an optional `reason` string that gets stored in `state.json`).
3. If your reasoning is "I'm not sure if it's Artemis II," you almost
   certainly want to reject.
4. If your reasoning is "I'd want this in a 'broader Artemis' collection
   but not this specific one," reject — the collection's focus is Artemis II.

# Image-check evidence records — metadata only, flagged only, never bytes

**Status:** accepted (2026-07-17)

## Decision

Right-click image checks that FLAG (Hive `aiGenerated.likely` OR
`deepfake.likely`) are persisted to `image_check_records` (migration v239) as
**metadata only**: image URL, page URL, SHA-256 of the fetched bytes,
confidences, generator breakdown, Content-Credentials presence, vision
summary, impersonation matches, and a timestamp — keyed by a human-quotable
`check_ref` (`IC-` + 12 Crockford-base32 chars, ~60 bits). Three hard rules:

1. **Never image bytes.** No pixels, no thumbnails, no screenshots. The
   ADR-0010 "images are discarded" public promise holds unmodified for pixel
   data; `image_sha256` exists so a third party (user, platform, police) who
   _already holds_ the image can corroborate that it is the one we checked.
2. **Flagged checks only.** Clean checks stay fully ephemeral — no row, no
   ref. Persisting everything would be better eval data but a worse privacy
   story, and evidence value concentrates entirely in the flagged tail.
3. **Install identity only as a hash.** `install_id_hash =
sha256(install_id)` — enough to correlate a burst of checks from one
   install, never enough to link back to the extension identity tables.

Persistence is gated by its own server-only flag `FF_IMAGE_CHECK_RECORDS`
(default OFF), independent of the route flag, so records can be switched off
without darkening the check itself. Retention: 365 days, then the v118
archive-shadow mover (`archive_secondary_tables_batch`, extended to 7 tables
in v239) moves rows to `image_check_records_archive` (deny-all RLS).

## Context

Image-check v2 adds an evidence angle for users, government, and law
enforcement (NSW-police-pilot direction): a check should produce something a
victim can attach to a ReportCyber/eSafety report and an analyst can query.
That requires persistence — but ADR-0010 (2026-05-22) established, after the
R2 screenshot incident, that images are discarded immediately: `scrubPII` is
text-only and cannot redact an image, so any stored image is unredactable
PII. This ADR threads that needle: the _evidence_ is the measurement, not
the media.

## Considered options

- **Persist bytes with user opt-in** — strongest for LE (the image itself is
  preserved even if the source deletes it), but requires privacy-policy
  changes, consent UX, and an unredactable-PII store. Deferred; the SHA-256
  covers corroboration when any other party retains the image.
- **Persist every check** — better false-positive telemetry, but grows the
  table ~10× for rows with no evidence value and makes "we keep almost
  nothing" harder to say. Rejected.
- **Reuse `deepfake_detections`** — celebrity-gated (`celebrity_name NOT
NULL`) and ad-shaped; generalising it would weaken its existing B2B
  contract. Rejected in favour of a purpose-built lean table.

## Consequences

- The public evidence page (`/image-check/[ref]`) and PDF are keyed on the
  unguessable ref alone — ~60 bits against a corpus of at most thousands of
  rows makes enumeration impractical. Missing refs, malformed refs, and
  flag-off all render the identical not-found page, so a probe learns
  nothing about which refs exist.
  **Verified 2026-07-17 against a running server:** the _page_ returns HTTP
  **200** with that not-found body, not 404 — `notFound()` fires after
  streaming has begun, so the status is already flushed. This is
  pre-existing and app-wide (`/charity-check`, `/scam-feed`, `/extension/link`
  behave the same), not specific to this feature, and it does not weaken the
  property above (the body is what an attacker sees, and it is identical).
  The PDF route returns a real 404 because it sets the status explicitly.
  Tracked in BACKLOG → soft-404 on flag-gated pages.
- `/api/v1/image-checks` (B2B/LE feed) must never expose `install_id_hash`
  or raw `hive_result`.
- If byte retention is ever added, it supersedes this ADR and requires a
  privacy-policy update + explicit consent UX, not a flag flip.

## Supersedes / relates

- Supersedes-in-part **ADR-0010** (screenshot retention gated): 0010's
  blanket-discard stance now applies to bytes; check _metadata_ may persist
  under the rules above.
- Relates to `docs/plans/image-check-v2.md` (the wave) and
  `docs/ops/extension-image-check-config.md` (flags/ops).

# Screenshot retention is gated behind a default-OFF flag pending PII redaction

**Status:** accepted (2026-05-22)

`storeVerifiedScam`'s screenshot→R2 upload is gated behind a new
server-side flag `FF_SCREENSHOT_RETENTION`, default **OFF**. While OFF, the
uploaded screenshot of a HIGH_RISK image submission is discarded after
analysis, exactly as before. The R2 bucket misconfiguration that made the
upload silently fail is fixed independently, so R2 stays healthy for its
other consumers.

## Context

Investigating a P1 (image uploads returning a generic error — PR #356) led
to a check of R2 screenshot storage. Findings:

- R2 image storage had **never worked**. `R2_BUCKET_NAME` was set to
  `ask-arthur-bucket`, which does not exist; the real bucket is
  `ask-arthur-r2`. Every `PutObjectCommand` threw `NoSuchBucket`, caught by
  `storeVerifiedScam` as a non-blocking error. `verified_scams.screenshot_key`
  was null on all 43 rows.
- Simply correcting the bucket name would have **silently switched on**
  retention of raw user screenshots for every HIGH_RISK image submission —
  with no code review of that as a behaviour change.
- `scrubPII` is text-only (`string → string`). It runs on submitted text
  and on Claude's text output; it cannot touch an image. A stored
  screenshot is therefore raw, unredacted user content — faces, bank-app
  screens, government IDs, and the victim's own details visible in their
  inbox.
- The homepage and the privacy policy (sections 1, 2, 6) state that
  submitted images are discarded immediately after analysis.
- The project already treats retention conservatively: the
  training-consent pipeline is opt-in, PII-redacted, and was slated for
  legal review (Clayton Utz / MinterEllison). The only existing consent
  signal, `training_consent`, is collected on the post-result feedback
  widget — it cannot gate an upload that happens during `/api/analyze`,
  before the user has seen any result.

## Decision

- The bucket misconfiguration is fixed regardless: `R2_BUCKET_NAME` →
  `ask-arthur-r2` in Vercel, and `getBucket()`'s fallback default is
  corrected. R2 is healthy for its other consumers (media/audio analysis,
  Phone Footprint PDFs).
- The screenshot→R2 upload **specifically** is gated behind
  `FF_SCREENSHOT_RETENTION`, default OFF. The analyze route passes
  `undefined` as the uploader when the flag is off; `storeVerifiedScam`
  already no-ops without an uploader.
- This keeps the "images are discarded" promise true and avoids storing
  unconsented, unredactable PII on the back of a config fix.

## Consequences

- No behaviour change for users today — screenshots are still discarded
  after analysis.
- The scam-evidence corpus does not accrue screenshots until the flag is
  flipped.
- CLAUDE.md's "Never Do: store raw user content or PII" remains satisfied
  while the flag is OFF.

## Prerequisites before flipping `FF_SCREENSHOT_RETENTION` ON

1. **Image PII handling** — either OCR + redaction (inpainting of faces,
   IDs, account numbers), OR an explicit upload-time consent checkbox.
2. **Legal review** of raw-screenshot retention, consistent with the
   training-consent review.
3. **R2 lifecycle rule** on the `screenshots/` prefix — the keys are
   date-prefixed (`screenshots/{YYYY-MM-DD}/…`) so a bounded-expiry rule
   (e.g. 90 days) is a one-liner.
4. **Privacy copy update** — the homepage line plus privacy-policy
   sections 1, 2 and 6 — to disclose retention, its scope (HIGH_RISK image
   checks only), and the retention window.

## Reversal trigger

If image PII redaction or an upload-time consent path is never built,
remove the `uploadScreenshot` path entirely rather than leaving a dormant
flag — a permanently-OFF flag is dead code.

## Related

- PR #356 — the P1 image-upload fix whose investigation surfaced this.
- CLAUDE.md — "Never Do: Store raw user content or PII".

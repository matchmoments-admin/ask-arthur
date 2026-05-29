# Proactive, system-triggered onward reporting + the Brand Stewardship ledger

**Status:** accepted (2026-05-29)

The `onward` reporting subsystem (v119) was built as a **user-initiated** flow:
a person reviews their own scan result and picks which destinations
(Scamwatch, ACMA, brand abuse, …) to forward it to. PRs #533/#534 extend it to
a **system-initiated** posture: Ask Arthur proactively reports HIGH*RISK
phishing URLs to neutral blocklists (OpenPhish, APWG) \_without* a human
clicking, and keeps a per-brand monthly ledger (`brand_stewardship_reports`) of
what it detected + reported on each brand's behalf. We record this because it
changes the subsystem's trust model and is hard to reverse once brands start
receiving stewardship summaries built on the ledger.

## Context

The brand-protection research (2026-05-29) found that (a) we already detect far
more than we act on, and (b) we can act on a brand's behalf — and open
partnership conversations from demonstrated value — without needing the brand's
sign-off, because reporting a phishing URL to a neutral public-interest
blocklist needs no permission. The cheapest path was to extend the existing
onward subsystem rather than build parallel infrastructure (see ADR-0016's
"discriminate, don't parallelise" principle; the onward subsystem already owns
the `onward_report_log` ledger, the dispatcher, the workers, and the
`/admin/onward-reports` surface).

Two new properties are the real decision:

1. **No human gate on the auto-report path.** `onward-brand-abuse` holds the
   first N sends per brand for admin approval; the new `report-onward-auto-report`
   producer does not. The justification: OpenPhish/APWG are neutral blocklists,
   not brand relationships, and ACMA's intake worker (`onward-acma`) already
   auto-forwards without a gate on the same reasoning.
2. **The brand-stewardship ledger is the proof artifact.** It records, per brand
   per month, what we detected + reported — the evidence we keep "to prove and
   assist when needed," and the basis for the monthly summary email to brands.

## Decision

- **Proactive producer** (`report-onward-auto-report`, #533): hourly cron,
  sweeps recent HIGH*RISK `scam_reports` carrying a scammer URL, auto-enqueues
  onward reports to the \_enabled* URL-blocklist destinations only. Triple-gated
  (`FF_ONWARD_AUTO_REPORT` + per-destination `FF_ONWARD_OPENPHISH`/`FF_ONWARD_APWG`).
- **Brand Stewardship ledger** (`brand_stewardship_reports` v166 +
  `report-brand-stewardship` monthly cron, #534): per-brand monthly rollup over
  `onward_report_log`, contact-gated to brands with a `known_brands` email
  contact. Gated by `FF_BRAND_STEWARDSHIP_REPORT`.
- **Honesty by construction:** only `status='sent'` rows count as "reported";
  `detected` de-dupes by `scam_report_id`; no "taken down" claim is ever made
  (these are fire-and-forget email intakes with no takedown callback).

## Pre-flip requirements (before any `FF_ONWARD_*` / stewardship flag goes ON)

These are deliberately NOT blocking the merge (all flags default OFF), but MUST
be satisfied before enabling, and are tracked as follow-ups:

1. **Per-URL dedup / abuse throttle (ultrareview F9).** Dedup is currently
   `(scam_report_id, destination, destination_key)`, so the same victim URL
   across N HIGH_RISK reports → N blocklist submissions. Before flipping
   `FF_ONWARD_AUTO_REPORT` ON, add a per-URL throttle (or a short FP cool-off,
   or restore a manual gate à la `brand_abuse`) so a wrong HIGH_RISK verdict
   can't be amplified into getting a benign site blocklisted.
2. **URL query-string redaction (ultrareview F8).** Shipped: `stripUrlPii`
   removes query+fragment before forwarding (a captured phishing URL can carry
   victim PII in `?email=…`). Keep this in any future destination that forwards
   URLs.
3. **Deliverability validation.** Send one real report to each intake
   (report@openphish.com, reportphishing@apwg.org) and confirm Resend delivers
   - the intake accepts, before enabling the producer.
4. **Brand-facing copy legal review (#371).** The Brand Stewardship _email_
   (not in #534, which is the ledger only) must use the lawyer-vetted language
   pack before any summary is sent to a brand.
5. **Failure visibility (ultrareview F6).** Shipped: onward failures emit an
   `onward-report-error` $0 cost-telemetry diagnostic so the daily health digest
   catches a persistently-failing intake.

## Reversal trigger

If the auto-report path produces a material false-positive rate (benign sites
reported) once enabled, turn `FF_ONWARD_AUTO_REPORT` OFF (the per-destination
worker flags and the user-initiated onward flow are unaffected) and revert to
manual-gated reporting. If a blocklist intake objects to our volume or
automated submissions, turn its destination flag OFF.

## Related

- ADR-0016 — onward/clone-detection surface separation ("discriminate, don't parallelise")
- v119 — onward_report_log + dispatcher + get_onward_destinations
- v165 — onward_destination enum += openphish, apwg
- v166 — brand_stewardship_reports ledger
- #371 — lawyer-vetted brand-outreach language pack (gates the stewardship email)
- local-ultrareview 2026-05-29 — findings F6, F8, F9 captured above

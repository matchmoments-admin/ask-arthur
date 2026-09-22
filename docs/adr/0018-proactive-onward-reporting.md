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

## Amendment 2026-09-23 — clone takedowns report through the onward ledger (v318)

**Context.** Clone-watch enforcement kept a second reporting ledger.
`shopfront-clone-enforcement-execute` redeclared the APWG/OpenPhish intake
addresses (as did four other files), emailed them inline, and recorded the send
only in `shopfront_takedown_attempts` + `cost_telemetry`. So the same URL could
reach a blocklist twice — once from a HIGH_RISK scam report, once from clone
enforcement — which is exactly pre-flip item 1 (F9) across ledgers;
`/admin/onward-reports` never showed a clone send; and `report-brand-stewardship`
counted only `onward_report_log`, leaving clone sends out of a brand's
"reported" total. Prod on 2026-09-23: `onward_report_log` 0 rows,
`shopfront_takedown_attempts` 0 rows, `FF_CLONE_ENFORCEMENT` off — the cheapest
moment to converge.

**Decision.** One ledger, two sources.

- `onward_report_log` gains `source` (`scam_report` | `clone_alert`),
  `clone_alert_id` (FK, ON DELETE SET NULL) and `url_key`. A CHECK ties each
  source to its subject; it is keyed on `source`, not "one of the two ids",
  because the v152 FP purge deletes clone alerts and the proof that we reported
  a later-FP URL must survive (it is the evidence the reversal trigger needs).
- **Per-URL dedup (closes F9 for the proactive paths):** unique
  `(destination, destination_key, url_key)`, `url_key = onward_url_key(url)`
  (host+path, lower-cased, no query). Both proactive producers enqueue through
  `enqueue_onward_url_reports`, whose `ON CONFLICT DO NOTHING` absorbs both
  unique indexes and returns only inserted rows. The canonicaliser is SQL-only,
  and the clone worklist (`list_clone_alerts_pending_onward`) excludes by the
  same predicate, so a URL already reported from a scam report cannot
  re-present at the head of the clone worklist forever.
- `shopfront-clone-enforcement-execute` becomes a **producer**: it enqueues
  `source='clone_alert'` rows and fires `report.onward.<destination>`; the
  existing `report-onward-openphish` / `-apwg` workers send, re-verifying
  `lifecycle_state='weaponised'` at send time, stripping query/fragment (F8) and
  honouring `ONWARD_CANARY_RECIPIENT`. A destination is used only when its worker
  flag is on, so the reversal lever below ("turn its destination flag OFF") now
  stops it for both sources.
- Intake addresses live only in `apps/web/lib/onward/destinations.ts`
  (guarded by `__tests__/onwardCloneLedger.test.ts`).
- `netcraft` is added to `onward_destination` as a ledger-only label (no
  worker, never user-routable). Making the Netcraft submit lane a producer is a
  follow-up, sequenced after PR 3 of the clone-watch deepening plan.
- `shopfront_takedown_attempts` is kept as the HUMAN-GATED case workflow
  (GSB / SmartScreen deep-links, registrar / hosting abuse with four-eyes). Auto
  channels no longer open cases there. The admin registrar/hosting send still
  records its send in the case table — moving it onto the ledger is a follow-up.
- The onward workers move from `rateLimit` to `throttle` (60/h per intake): with
  two producers, a discarded over-limit event would strand a `queued` row.
- The shared daily cap counts a new `enforcement.queued` event (execute records
  one per enqueued row) alongside `enforcement.reported` (the human send).

**Consequences.** Stewardship "reported" includes clone sends (brand resolved via
the alert's target domain → `known_brands.brand_name`); the admin page shows a
source column. Pre-flip items 3 (deliverability) and 4 (legal copy) are
unchanged. Rows reported under a `scam_report` source use the report's PRIMARY
(first) scammer URL as the dedup key; the email still lists every URL. User-click
rows carry no `url_key` — a human decision is not deduped against the proactive
paths.

**Reversal.** Code: revert the PR (the workers accept pre-v318 events unchanged).
Schema: v318 is additive except `DROP FUNCTION list_enforcement_cases_pending_send`
(re-apply v205 to restore).

-- v276 — backfill the alerts the reputation branch classified but never advanced.
--
-- Companion to the code fix in lib/clone-watch/urlscan-submit-one.ts. That branch
-- (submit failed, but Safe Browsing / VirusTotal called it malicious anyway)
-- wrote the VERDICT via persist_clone_alert_urlscan and never the LIFECYCLE via
-- apply_clone_urlscan_verdict. Consequences for every affected row:
--
--   * lifecycle_state stayed 'declined' — so the weaponised-after-decline count,
--     which is the whole vendor-gap story, under-reported.
--   * weaponised_at stayed NULL — so the row never satisfied the retrieve fn's
--     durable emit gate (weaponised_at NOT NULL AND weaponised_notified_at NULL),
--     no weaponised.v1 fired, no brand alert, no enforcement plan.
--
-- Scope, measured 2026-08-09. 17 rows are likely_phishing with weaponised_at
-- NULL, but only 12 are the defect:
--   * 5 are lifecycle_state='taken_down'. apply_clone_urlscan_verdict deliberately
--     does NOT weaponise a terminal state, so those are CORRECT as they stand and
--     are excluded here. (3 of them reached likely_phishing through the retrieve
--     lane, which already calls both RPCs — further confirmation that the
--     omission is specific to the submit-side reputation branch.)
--   * 12 are lifecycle_state='declined' with urlscan_evidence stage
--     'submit_failed' — the genuine leak.
--
-- All 17 are triage_status='tp_actioned' and were already submitted to Netcraft,
-- so the leak never blocked enforcement. This backfill restores metrics and the
-- lifecycle record, it does not rescue an unreported threat.
--
-- TIMESTAMP CHOICE. weaponised_at is set to urlscan_scanned_at, the moment the
-- reputation verdict was actually persisted — NOT now(). Stamping now() would
-- date a July detection to August and corrupt every first_seen -> weaponised
-- duration, which is the same class of defect as v273's decline-clock restamp.
-- Use the timestamp the evidence already carries.
--
-- NOTIFICATION SUPPRESSED. weaponised_notified_at is stamped in the same
-- statement so the retrieve fn's emit step does not fire 12 brand alerts for
-- domains detected up to four weeks ago and already reported to Netcraft. Late
-- alerts about already-actioned domains are noise to a pilot brand, not a
-- service. Set it to the same historical timestamp for the same reason as above.
--
-- KNOWN CONSEQUENCE, not a defect in this migration: netcraft_declined_at on
-- these rows was corrupted by the pre-v273 restamp, so some will now show
-- weaponised_at EARLIER than netcraft_declined_at. duration-kpis.ts already
-- routes negative pairs to excludedNegativeN rather than publishing them. Those
-- durations are unrecoverable either way; see v273.
--
-- Idempotent: the WHERE clause requires weaponised_at IS NULL, so re-running is a
-- no-op. Bounded at 12 rows — no chunking needed on this hot table.

UPDATE public.shopfront_clone_alerts sca
SET lifecycle_state = 'weaponised',
    weaponised_at = sca.urlscan_scanned_at,
    weaponised_notified_at = sca.urlscan_scanned_at,
    updated_at = now()
WHERE sca.source = 'nrd'
  AND sca.urlscan_classification = 'likely_phishing'
  AND sca.weaponised_at IS NULL
  AND sca.lifecycle_state = 'declined'
  AND sca.urlscan_scanned_at IS NOT NULL;

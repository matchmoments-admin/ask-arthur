-- v298 — persist the whole card, and give campaign clustering a home.
--
-- `clone_watch_report_summary` is the durable spine for a published edition,
-- but it only ever stored the twenty-odd values the slides quote. ELEVEN card
-- fields had no column: periodLabel, watchlistSize, kpis.neutral,
-- kpis.unresolved, kpis.unclassified, kpis.weaponisedAfterDecline, brandTrends,
-- targeting, registrarWeaponisation, tldWeaponisation and campaigns. An edition
-- therefore could not be rebuilt from its own record, which is why the LinkedIn
-- publish write-back re-computed the card from live data AFTER the human
-- approval gate — persisting numbers nobody had approved.
--
-- Two columns, both on a table holding three rows. No index, no hot-table
-- concern.
--
--   card_json  the exact card that produced the edition. The typed columns stay
--              the queryable projection; this is the bytes. It is what the
--              slide export, the caption and the publish write-back now all
--              read, so one edition is computed ONCE.
--
--   campaigns  shared-infrastructure clustering (summariseCampaigns). The card
--              has computed this since v189 and assigned it to a field with
--              ZERO readers — a tested pure function whose only caller threw
--              the result away. Persisted so it accrues month over month;
--              deliberately NOT published, because campaign_key hashes
--              registrar + nameservers + ASN + cert issuer and cannot evidence
--              one actor (targeting-copy.ts rule 3).
--
-- Idempotent. Both columns are nullable and pure-derived: rows written before
-- this migration simply lack them, and dropping either is lossless.

ALTER TABLE public.clone_watch_report_summary
  ADD COLUMN IF NOT EXISTS card_json jsonb,
  ADD COLUMN IF NOT EXISTS campaigns jsonb;

COMMENT ON COLUMN public.clone_watch_report_summary.card_json IS
  'The full CloneWatchReportCard that produced this edition. Written by the monthly snapshot; read by the slide export (?pinned=1), the caption and the publish write-back so all three use identical numbers. Pure-derived and rebuildable.';

COMMENT ON COLUMN public.clone_watch_report_summary.campaigns IS
  'summariseCampaigns() output — clones sharing one registrar/nameserver/ASN/cert fingerprint. Shared INFRASTRUCTURE, never evidence of one actor; not published.';

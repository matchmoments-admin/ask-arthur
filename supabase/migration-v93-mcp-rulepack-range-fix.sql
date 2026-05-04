-- migration-v93-mcp-rulepack-range-fix.sql
-- Corrects 5 wrong vulnerableRange values that v90 seeded into both
-- public.vulnerability_exposure_checks (used by mcp-audit scans) and
-- public.vulnerabilities.affected_versions (used by match-b2b-exposure).
--
-- Why this exists: v90's MCP rulepack seed used range bounds that were
-- approximations rather than the actual fix versions from NVD/GHSA.
-- Verified against authoritative sources by re-audit on 2026-05-04 after
-- a live scan of mcp-remote@0.1.38 produced a false-positive detection
-- for CVE-2025-6514 (the patch landed in 0.1.16, not 1.0.0).
--
--   CVE              Package                                  Was      Now
--   CVE-2025-6514    mcp-remote                               <1.0.0   <0.1.16
--   CVE-2026-23744   mcpjam-inspector                         <2.0.0   <1.4.3
--   CVE-2025-53109   @modelcontextprotocol/server-filesystem  <0.6.3   <0.6.4
--   CVE-2025-53110   @modelcontextprotocol/server-filesystem  <0.6.3   <0.6.4
--   CVE-2025-59528   flowise                                  <2.2.8   >=2.2.7 <3.0.6
--
-- Three targets in this migration:
--   1. UPDATE vulnerability_exposure_checks.check_config range
--   2. UPDATE vulnerabilities.affected_versions JSONB range
--   3. DELETE vulnerability_detections rows that referenced the 5 vulns
--      (next scanner runs will re-evaluate against corrected ranges; any
--      surviving false positives in prod are stale rows that no longer
--      reflect reality, safer to purge than leave to mislead the B2B
--      exposure feed)
--
-- Idempotent: each UPDATE is restricted by package_name + the OLD bad range
-- so re-running is a no-op. The DELETE is bounded by identifier so re-runs
-- match the same set of rows (which will already be empty after first run).
--
-- Regression-test guard: packages/mcp-audit/src/cve-rulepack.ts now carries
-- a firstPatchedVersion field on every McpCveRule, and
-- cve-rulepack.test.ts asserts matchCve(pkg, firstPatchedVersion)
-- returns []. That's the assertion that would have caught all 5 of these
-- at PR-1 review.

-- ── 1. Fix vulnerability_exposure_checks.check_config ───────────────────

update public.vulnerability_exposure_checks
   set check_config = jsonb_set(check_config, '{range}', '"<0.1.16"')
 where check_type = 'version_range'
   and check_config->>'package' = 'mcp-remote'
   and check_config->>'range' = '<1.0.0';

update public.vulnerability_exposure_checks
   set check_config = jsonb_set(check_config, '{range}', '"<1.4.3"')
 where check_type = 'version_range'
   and check_config->>'package' = 'mcpjam-inspector'
   and check_config->>'range' = '<2.0.0';

update public.vulnerability_exposure_checks
   set check_config = jsonb_set(check_config, '{range}', '"<0.6.4"')
 where check_type = 'version_range'
   and check_config->>'package' = '@modelcontextprotocol/server-filesystem'
   and check_config->>'range' = '<0.6.3';

update public.vulnerability_exposure_checks
   set check_config = jsonb_set(check_config, '{range}', '">=2.2.7 <3.0.6"')
 where check_type = 'version_range'
   and check_config->>'package' = 'flowise'
   and check_config->>'range' = '<2.2.8';

-- ── 2. Fix vulnerabilities.affected_versions JSONB ──────────────────────
-- match-b2b-exposure reads this JSONB array directly (not via the exposure
-- checks table) and runs semver.satisfies on each entry's `range` field.
-- Without this update, the B2B path would still false-positive even after
-- the exposure_checks UPDATE above.

update public.vulnerabilities
   set affected_versions = jsonb_build_array(jsonb_build_object('range', '<0.1.16'))
 where identifier = 'CVE-2025-6514';

update public.vulnerabilities
   set affected_versions = jsonb_build_array(jsonb_build_object('range', '<1.4.3'))
 where identifier = 'CVE-2026-23744';

update public.vulnerabilities
   set affected_versions = jsonb_build_array(jsonb_build_object('range', '<0.6.4'))
 where identifier in ('CVE-2025-53109','CVE-2025-53110');

update public.vulnerabilities
   set affected_versions = jsonb_build_array(jsonb_build_object('range', '>=2.2.7 <3.0.6'))
 where identifier = 'CVE-2025-59528';

-- ── 3. Purge stale detections referencing the 5 affected vulns ──────────
-- Some of these rows are confirmed false positives (prod row id=1 is
-- mcp-remote@0.1.38 → CVE-2025-6514, which is patched). Rather than
-- selectively delete only the ones we can prove are wrong, purge ALL
-- detections for these 5 vulns. The scanner write path is idempotent —
-- next time a customer scans a genuinely-vulnerable target, the row will
-- be re-written with the correct range applied at scan time. The cost of
-- a single rebuilt row is far lower than the cost of a wrong detection
-- sitting in the B2B exposure feed.

delete from public.vulnerability_detections d
 using public.vulnerabilities v
 where d.vulnerability_id = v.id
   and v.identifier in (
     'CVE-2025-6514',
     'CVE-2026-23744',
     'CVE-2025-53109',
     'CVE-2025-53110',
     'CVE-2025-59528'
   );

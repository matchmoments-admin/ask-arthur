-- migration-v91-mcp-rulepack-checks-fix.sql
-- Corrective follow-up to v90.
--
-- The original v90 used a single statement with a modifying CTE that INSERTed
-- into public.vulnerabilities and then JOINed public.vulnerabilities for the
-- exposure_checks INSERT. Because all sub-statements in WITH share one
-- snapshot, the JOIN couldn't see the rows the CTE had just inserted —
-- result: 12 vulnerabilities seeded, 0 exposure checks. v90 has since been
-- rewritten to use a temp table + two separate statements (so a fresh DB
-- gets the correct end state), but prod already ran the broken version.
-- This migration fills in the missing exposure_checks rows.
--
-- Idempotent: ON CONFLICT DO NOTHING. Re-runs are safe and a no-op once
-- complete. Safe on fresh DBs too — by the time v91 runs, v90's corrected
-- form has already populated exposure_checks, and ON CONFLICT skips the
-- duplicate inserts.

insert into public.vulnerability_exposure_checks (vulnerability_id, scanner, check_type, check_config)
select v.id, 'mcp-audit', 'version_range',
  jsonb_build_object('package', pkg, 'range', range_)
from public.vulnerabilities v
join (values
  ('CVE-2025-4144',  '@cloudflare/workers-oauth-provider',      '<0.0.5'),
  ('CVE-2025-4143',  '@cloudflare/workers-oauth-provider',      '<0.0.5'),
  ('CVE-2025-6514',  'mcp-remote',                              '<1.0.0'),
  ('CVE-2025-49596', '@modelcontextprotocol/inspector',         '<0.14.1'),
  ('CVE-2025-53109', '@modelcontextprotocol/server-filesystem', '<0.6.3'),
  ('CVE-2025-53110', '@modelcontextprotocol/server-filesystem', '<0.6.3'),
  ('CVE-2025-59528', 'flowise',                                 '<2.2.8'),
  ('CVE-2025-68143', 'mcp-server-git',                          '<0.7.0'),
  ('CVE-2025-68144', 'mcp-server-git',                          '<0.7.0'),
  ('CVE-2025-68145', 'mcp-server-git',                          '<0.7.0'),
  ('CVE-2026-23744', 'mcpjam-inspector',                        '<2.0.0'),
  ('MCP-2026-STDIO', '@modelcontextprotocol/sdk',               '<1.5.0')
) as r(cve, pkg, range_) on r.cve = v.identifier
on conflict (vulnerability_id, scanner, check_type) do nothing;

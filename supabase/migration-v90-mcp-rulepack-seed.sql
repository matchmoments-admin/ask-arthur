-- migration-v90-mcp-rulepack-seed.sql
-- Seeds the 12 known MCP-ecosystem CVEs from packages/mcp-audit/src/cve-rulepack.ts
-- into public.vulnerabilities + public.vulnerability_exposure_checks.
--
-- Why this exists: v63 created the schema for the Vulnerability Intelligence DB
-- (Phase 14 Sprint 1) but the rulepack-to-database seed was deferred. Without
-- seeded vulnerabilities, the `recordDetection()` path from mcp-audit scans has
-- nothing to look up by identifier, so vulnerability_detections stays empty.
--
-- Idempotent: ON CONFLICT (identifier) DO NOTHING +
-- ON CONFLICT (vulnerability_id, scanner, check_type) DO NOTHING. Re-runs are
-- safe; existing scraper-sourced rows (if any) take precedence over this seed.
-- When the rulepack grows in code, ship a follow-up migration. The parity test
-- packages/mcp-audit/src/__tests__/cve-rulepack-seed-parity.test.ts ensures the
-- SQL and the TS source stay in lockstep.
--
-- Why two statements + temp table (not a single CTE): modifying CTEs run on
-- the same snapshot, so a single statement that INSERTs into vulnerabilities
-- and then JOINs vulnerabilities for the exposure_checks INSERT cannot see
-- the just-inserted rows. Separate statements in the same transaction get a
-- fresh snapshot each, so the second INSERT sees what the first wrote. The
-- temp table avoids duplicating the 12-row VALUES list across both statements.

create temporary table _mcp_rulepack_seed (
  cve              text,
  identifier_type  text,
  cvss             numeric,
  severity         text,
  category         text,
  package_name     text,
  vulnerable_range text,
  summary          text,
  ref              text
) on commit drop;

insert into _mcp_rulepack_seed values
  ('CVE-2025-4144',  'cve',     5.3, 'medium',   'mcp', '@cloudflare/workers-oauth-provider',      '<0.0.5',  'PKCE downgrade via missing code_challenge validation',                       'https://nvd.nist.gov/vuln/detail/CVE-2025-4144'),
  ('CVE-2025-4143',  'cve',     5.3, 'medium',   'mcp', '@cloudflare/workers-oauth-provider',      '<0.0.5',  'Redirect URI validation bypass',                                              'https://nvd.nist.gov/vuln/detail/CVE-2025-4143'),
  ('CVE-2025-6514',  'cve',     9.6, 'critical', 'mcp', 'mcp-remote',                              '<1.0.0',  'Command injection via authorization_endpoint — 558K+ downloads affected',     'https://nvd.nist.gov/vuln/detail/CVE-2025-6514'),
  ('CVE-2025-49596', 'cve',     9.4, 'critical', 'mcp', '@modelcontextprotocol/inspector',         '<0.14.1', 'RCE via 0.0.0.0 + DNS rebinding',                                             'https://nvd.nist.gov/vuln/detail/CVE-2025-49596'),
  ('CVE-2025-53109', 'cve',     8.4, 'high',     'mcp', '@modelcontextprotocol/server-filesystem', '<0.6.3',  'Symlink bypass of directory containment',                                     'https://nvd.nist.gov/vuln/detail/CVE-2025-53109'),
  ('CVE-2025-53110', 'cve',     7.3, 'high',     'mcp', '@modelcontextprotocol/server-filesystem', '<0.6.3',  'Directory containment bypass',                                                'https://nvd.nist.gov/vuln/detail/CVE-2025-53110'),
  ('CVE-2025-59528', 'cve',    10.0, 'critical', 'mcp', 'flowise',                                 '<2.2.8',  'RCE via Function() eval in CustomMCP',                                        'https://nvd.nist.gov/vuln/detail/CVE-2025-59528'),
  ('CVE-2025-68143', 'cve',     6.4, 'medium',   'mcp', 'mcp-server-git',                          '<0.7.0',  'Unrestricted git_init in chain with CVE-2025-68144/5',                        'https://nvd.nist.gov/vuln/detail/CVE-2025-68143'),
  ('CVE-2025-68144', 'cve',     6.4, 'medium',   'mcp', 'mcp-server-git',                          '<0.7.0',  'Argument injection',                                                          'https://nvd.nist.gov/vuln/detail/CVE-2025-68144'),
  ('CVE-2025-68145', 'cve',     6.4, 'medium',   'mcp', 'mcp-server-git',                          '<0.7.0',  'Path bypass',                                                                 'https://nvd.nist.gov/vuln/detail/CVE-2025-68145'),
  ('CVE-2026-23744', 'cve',     9.8, 'critical', 'mcp', 'mcpjam-inspector',                        '<2.0.0',  'RCE via crafted PDF',                                                         'https://nvd.nist.gov/vuln/detail/CVE-2026-23744'),
  ('MCP-2026-STDIO', 'custom',  8.1, 'high',     'mcp', '@modelcontextprotocol/sdk',               '<1.5.0',  'Unsafe STDIO defaults — 7000+ public servers affected',                       'https://mcp.modelcontextprotocol.io/advisories/stdio-2026');

insert into public.vulnerabilities (
  identifier, identifier_type, title, summary,
  cvss_score, severity, category,
  affected_products, affected_versions,
  external_references, source_feeds
)
select
  s.cve,
  s.identifier_type,
  s.package_name || ' ' || s.vulnerable_range || ': ' || s.summary,
  s.summary,
  s.cvss,
  s.severity,
  s.category,
  jsonb_build_array(s.package_name),
  jsonb_build_array(jsonb_build_object('range', s.vulnerable_range)),
  jsonb_build_array(jsonb_build_object('url', s.ref)),
  array['mcp-rulepack']
from _mcp_rulepack_seed s
on conflict (identifier) do nothing;

insert into public.vulnerability_exposure_checks (vulnerability_id, scanner, check_type, check_config)
select v.id, 'mcp-audit', 'version_range',
  jsonb_build_object('package', s.package_name, 'range', s.vulnerable_range)
from _mcp_rulepack_seed s
join public.vulnerabilities v on v.identifier = s.cve
on conflict (vulnerability_id, scanner, check_type) do nothing;

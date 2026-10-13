/**
 * v344 re-creates list_clone_alerts_for_recheck, and so does v343 (#1307).
 * v344 must be built on v343's body: a v334-based copy applied after v343
 * would silently put back the `urlscan_evidence->>'status' = '400'` dead test
 * that v343 replaced with the NULL-safe clone_alert_dns_dead predicate.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(__dirname, "../../../supabase/migration-v344-recheck-risk-input-assembly.sql"),
  "utf8",
);
const body = (() => {
  const start = SQL.indexOf("CREATE FUNCTION public.list_clone_alerts_for_recheck");
  const open = SQL.indexOf("$function$", start);
  const close = SQL.indexOf("$function$", open + 1);
  return SQL.slice(open, close).replace(/--[^\n]*/g, " ");
})();

describe("migration v344 list_clone_alerts_for_recheck", () => {
  it("keeps v343's dead predicate and never the raw status-400 test", () => {
    expect(body).toContain(
      "public.clone_alert_dns_dead(sca.dns_precheck, sca.urlscan_evidence)",
    );
    expect(body).not.toMatch(/urlscan_evidence\s*->>\s*'status'/);
  });

  it("guards on v343 being applied first", () => {
    expect(SQL).toMatch(/to_regprocedure\('public\.clone_alert_dns_dead\(text, jsonb\)'\)/);
  });

  it("returns the category lookup key and resolves brand_category deterministically", () => {
    expect(body).toContain("sca.inferred_target_domain");
    expect(body).toMatch(/brand_category IS NOT NULL\s+ORDER BY kb2\.id\s+LIMIT 1/);
  });
});

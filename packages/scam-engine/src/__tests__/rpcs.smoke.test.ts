// SQL RPC smoke tests — call each pgvector-driven function with a
// synthetic query vector and assert it returns without throwing.
//
// Why this exists: 2026-05-06 we discovered three latent bugs in
// hand-authored PL/pgSQL functions (id-ambiguity, missing aggregate,
// search_path-vs-pgvector) that all surface as immediate exceptions on
// the first invocation, regardless of input data. None of them were
// caught by the existing unit tests because those mock supabase.rpc
// rather than executing real SQL. A single live invocation per RPC
// would have caught all three pre-merge.
//
// CI posture: the suite is gated on
//   SUPABASE_INTEGRATION_TEST_URL
//   SUPABASE_INTEGRATION_TEST_SERVICE_KEY
// When either is absent (default in CI without secrets configured),
// every test is skipped. Operators run this manually after applying
// migrations to a Supabase preview branch:
//
//   SUPABASE_INTEGRATION_TEST_URL=https://<branch>.supabase.co \
//   SUPABASE_INTEGRATION_TEST_SERVICE_KEY=<service_role_jwt> \
//   pnpm --filter @askarthur/scam-engine test rpcs.smoke
//
// The function calls are read-only — they execute SELECTs against the
// existing data and return rows. No mutation. Safe to point at prod
// (read-only data path) or any preview branch.

import { describe, it, expect } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_INTEGRATION_TEST_URL;
const serviceKey = process.env.SUPABASE_INTEGRATION_TEST_SERVICE_KEY;
const hasEnv = Boolean(url && serviceKey);

function getClient(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      "rpcs.smoke: SUPABASE_INTEGRATION_TEST_URL/SERVICE_KEY required",
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// 1024-dim synthetic vector. Doesn't need to match real data — every
// bug we're guarding against (id ambiguity, RRF aggregate, search_path
// vs pgvector operator) raises BEFORE any row-comparison happens.
const SYNTHETIC_VECTOR = Array(1024).fill(0.01);

describe.skipIf(!hasEnv)("SQL RPC smoke tests", () => {
  it("match_scam_reports executes without error", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("match_scam_reports", {
      p_query_embedding: SYNTHETIC_VECTOR,
      p_match_count: 5,
      p_min_similarity: 0.0,
      p_since_days: 30,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("match_scam_reports_hybrid executes without error (regression for v95 id-ambiguity + RRF aggregate)", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("match_scam_reports_hybrid", {
      p_query_text: "tax refund",
      p_query_embedding: SYNTHETIC_VECTOR,
      p_match_count: 5,
      p_min_similarity: 0.0,
      p_since_days: 30,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("match_themes_by_centroid executes without error (regression for v96 empty search_path)", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("match_themes_by_centroid", {
      p_query_embedding: SYNTHETIC_VECTOR,
      p_match_count: 3,
      p_min_similarity: 0.0,
      p_min_signal_strength: "weak",
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("match_reddit_intel executes without error", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("match_reddit_intel", {
      p_query_embedding: SYNTHETIC_VECTOR,
      p_match_count: 5,
      p_min_similarity: 0.0,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  // shop_checks retention RPC (v135). Non-destructive: batch size 0 means
  // LIMIT 0, so the DELETE touches no rows regardless of data. Exercises
  // the function body (search_path, SET LOCAL, GET DIAGNOSTICS) so a
  // broken PL/pgSQL definition fails here on the first call.
  it("cleanup_expired_shop_checks executes without error (non-destructive)", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("cleanup_expired_shop_checks", {
      p_batch_size: 0,
    });
    expect(error).toBeNull();
    expect(typeof data).toBe("number");
  });

  // Clone-watch preclassify selector (v159, PR-I #509). Exercises the
  // SECURITY DEFINER body (search_path, LEFT JOIN, LIMIT clamp) so a broken
  // definition fails here on the first call rather than silently in the
  // daily NRD fan-out.
  it("list_clone_alerts_pending_preclassify executes without error", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc(
      "list_clone_alerts_pending_preclassify",
      { p_limit: 1 },
    );
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  // Vendor-gap duration KPIs (v231). LANGUAGE sql aggregate over jsonb
  // timestamp casts — a broken cast/predicate fails here on the first call.
  // Always returns exactly one row (LEFT JOIN ON TRUE), even on empty data.
  it("clone_watch_vendor_gap_stats executes without error", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("clone_watch_vendor_gap_stats", {
      p_days: 90,
    });
    expect(error).toBeNull();
    const rows = Array.isArray(data) ? data : [data];
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.decline_to_weaponise_n).toBe("number");
  });

  // Stranded-count breakdown (v274/v286/v292/v293) — a metric that has now
  // regressed three times, always the same way: a worklist was widened and one
  // of these legs was not.
  //
  // BE CLEAR ABOUT WHAT THIS PROVES. `stranded_total` is DEFINED as
  // `count(*) FILTER (WHERE a OR b OR c)`, so "total >= each leg" is true for
  // any predicate whatsoever — including the v286 definition that overstated by
  // 285 rows. This case therefore guards execution (search_path, the CTE, the
  // grants) and shape, and nothing about correctness.
  //
  // The check that WOULD have caught every past regression is semantic and
  // needs row ids the RPC does not return, so it lives beside the worklists it
  // compares against — run it after any change to a worklist predicate:
  //
  //   WITH stranded AS (...the RPC's predicate...)
  //   SELECT count(*) FILTER (WHERE id IN (SELECT id FROM list_clone_alerts_for_recheck(1000,6,168)))
  //        + count(*) FILTER (WHERE id IN (SELECT id FROM list_clone_alerts_pending_urlscan_submit(100,0.7,3)))
  //   FROM stranded;   -- MUST be 0
  //
  // Verified 0 against prod on 2026-09-03 (v293). Documented in
  // docs/ops/clone-watch-config.md.
  it("clone_watch_urlscan_stranded_count executes and returns the documented shape", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc(
      "clone_watch_urlscan_stranded_count",
      { p_max_failure_streak: 3 },
    );
    expect(error).toBeNull();
    const rows = Array.isArray(data) ? data : [data];
    expect(rows).toHaveLength(1);
    const r = rows[0] as {
      stranded_total: number;
      stranded_streak: number;
      stranded_submitted_no_uuid: number;
      stranded_uuid_no_submitted_at: number;
    };
    for (const leg of [
      r.stranded_streak,
      r.stranded_submitted_no_uuid,
      r.stranded_uuid_no_submitted_at,
    ]) {
      expect(typeof leg).toBe("number");
      expect(r.stranded_total).toBeGreaterThanOrEqual(leg);
    }
  });

  // Unactioned-lookalike age snapshot (v231).
  it("clone_watch_unactioned_age_stats executes without error", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc(
      "clone_watch_unactioned_age_stats",
    );
    expect(error).toBeNull();
    const rows = Array.isArray(data) ? data : [data];
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.n).toBe("number");
  });

  // ── Watchlist curation + brand overlay (v254–v257) ────────────────────
  //
  // These matter more than most for this gate: createServiceClient() omits
  // the <Database> generic, so supabase.rpc() is UNTYPED app-wide. A renamed
  // argument or a dropped overload typechecks perfectly clean and fails at
  // runtime as PGRST202 — inside a weekly cron, where nobody sees it for
  // seven days. A live call per signature is the only real protection.

  it("aggregate_reddit_brands_with_au executes without error", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc(
      "aggregate_reddit_brands_with_au",
      {
        p_since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        p_min_count: 3,
      },
    );
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      // The invariant the v254 aggregate exists to provide.
      expect(Number(row.au_count)).toBeLessThanOrEqual(
        Number(row.mention_count),
      );
    }
  });

  it("aggregate_scam_report_brands executes without error", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("aggregate_scam_report_brands", {
      p_since: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      p_min_count: 2,
    });
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
  });

  it("list_active_monitored_brands executes and never yields a domainless brand", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("list_active_monitored_brands");
    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    for (const row of (data ?? []) as Array<{
      legitimate_domains?: string[];
    }>) {
      // legitimate_domains is the matcher's EXCLUSION list. An empty one makes
      // the brand's own site match as a clone of itself, which is why v256
      // guards it in BOTH a CHECK and this RPC's predicate.
      expect((row.legitimate_domains ?? []).length).toBeGreaterThan(0);
    }
  });

  // The three mutating RPCs below are exercised with arguments that provably
  // change nothing, so this file keeps its "safe to point at prod" contract:
  //   - a brand key that cannot exist -> the UPDATE matches 0 rows
  //   - an empty domain list -> promote RAISES before reaching its INSERT
  // What is being tested is that the SIGNATURE resolves. A wrong argument list
  // returns PGRST202 ("function not found"), which is exactly what these
  // assertions distinguish from a healthy call.
  const ABSENT_KEY = "rpcsmokeabsentbrand";

  it("set_watchlist_candidate_status resolves and no-ops on an absent brand", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc(
      "set_watchlist_candidate_status",
      {
        p_brand_normalized: ABSENT_KEY,
        p_status: "dismissed",
        p_note: "rpc smoke test — matches nothing",
      },
    );
    expect(error).toBeNull();
    expect(Number(data)).toBe(0); // 0 rows changed = nothing was mutated
  });

  it("demote_watchlist_candidate resolves and no-ops on an absent brand", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("demote_watchlist_candidate", {
      p_brand_normalized: ABSENT_KEY,
      p_note: "rpc smoke test — matches nothing",
    });
    expect(error).toBeNull();
    expect(Number(data)).toBe(0);
  });

  it("promote_watchlist_candidate rejects an empty domain list before inserting", async () => {
    const supabase = getClient();
    const { error } = await supabase.rpc("promote_watchlist_candidate", {
      p_brand_normalized: ABSENT_KEY,
      p_brand_name: "RPC Smoke Test",
      p_domains: [],
      p_aliases: [],
      p_note: "rpc smoke test — must not insert",
      p_source: "smoke",
    });
    // MUST error — an empty exclusion list is refused by design.
    expect(error).not.toBeNull();
    // …but not because the function is missing. PGRST202 here would mean the
    // argument list drifted from the SQL signature, which is the whole point
    // of this file.
    expect(error?.code).not.toBe("PGRST202");
    expect(String(error?.message ?? "")).toMatch(/domain/i);
  });

  it("the promote guard did not leave a row behind", async () => {
    // Proves the previous test's claim rather than assuming it: the RAISE
    // happens before the INSERT, so no monitored_brands row should exist.
    const supabase = getClient();
    const { data, error } = await supabase
      .from("monitored_brands")
      .select("id")
      .eq("brand_normalized", ABSENT_KEY);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  // ── migration-v262: mark_stale_urls ──────────────────────────────────
  //
  // v262 recreated this SECURITY DEFINER function with `SET search_path = ''`
  // and fully-qualified names, per supabase/CLAUDE.md rule 4 — v11 predated the
  // convention. That change is exactly the class of bug this suite exists for:
  // a search_path mistake surfaces as an immediate exception on first
  // invocation regardless of input data, and this function runs UNATTENDED at
  // 03:00 UTC daily via pipeline-staleness-check. A silent break there stops
  // URL expiry fleet-wide and nothing would page.
  //
  // Called with an absurd threshold so it is a guaranteed no-op — it resolves
  // every name, reads feed_sources, and builds the exempt array, but matches no
  // rows. Safe against prod.
  it("mark_stale_urls executes under search_path='' and is a no-op at an absurd threshold", async () => {
    const supabase = getClient();
    const { data, error } = await supabase.rpc("mark_stale_urls", {
      p_stale_days: 100000,
    });

    expect(error).toBeNull();
    // PGRST202 = function not found. Worth asserting explicitly because
    // createServiceClient() omits the <Database> generic, so a renamed or
    // dropped RPC typechecks clean everywhere else in the app.
    expect(error?.code).not.toBe("PGRST202");

    const result = data as {
      deactivated_count: number;
      exempt_feeds: string[];
    } | null;
    expect(result).toBeTruthy();
    expect(result?.deactivated_count).toBe(0);
    // The exemption is what allows a historical-signal feed to be retired
    // without its findings silently expiring — see migration-v262. If this
    // array comes back empty, crt.sh's 1,726 URLs are unprotected again.
    expect(Array.isArray(result?.exempt_feeds)).toBe(true);
    expect(result?.exempt_feeds).toContain("crtsh");
  });

  // ── migration-v264: feed_health ──────────────────────────────────────
  //
  // A view rather than a function, but the same failure mode: health-digest is
  // its only consumer and runs unattended, so a broken view means the digest
  // silently reports nothing wrong. The LEFT JOIN is the load-bearing part —
  // an enabled feed with no log rows must still produce a row, or "absent"
  // becomes undetectable again.
  it("feed_health returns one row per enabled feed, including feeds with no log rows", async () => {
    const supabase = getClient();
    const { data, error } = await supabase
      .from("feed_health")
      .select("feed_name, last_run_at, last_success_at, is_muted");

    expect(error).toBeNull();
    const rows = (data ?? []) as {
      feed_name: string;
      last_run_at: string | null;
      is_muted: boolean;
    }[];
    expect(rows.length).toBeGreaterThan(0);

    // Every row must carry a feed_name; a NULL last_run_at is EXPECTED and is
    // precisely the case the view exists to surface.
    for (const r of rows) {
      expect(typeof r.feed_name).toBe("string");
      expect(r.feed_name.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(hasEnv)("SQL RPC smoke tests — env not configured", () => {
  it("skipped (set SUPABASE_INTEGRATION_TEST_URL + SERVICE_KEY to enable)", () => {
    expect(hasEnv).toBe(false);
  });
});

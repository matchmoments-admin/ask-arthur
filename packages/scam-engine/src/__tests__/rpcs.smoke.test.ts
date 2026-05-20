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
});

describe.skipIf(hasEnv)("SQL RPC smoke tests — env not configured", () => {
  it("skipped (set SUPABASE_INTEGRATION_TEST_URL + SERVICE_KEY to enable)", () => {
    expect(hasEnv).toBe(false);
  });
});

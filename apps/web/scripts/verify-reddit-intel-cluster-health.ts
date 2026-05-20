/**
 * Reddit Intel cluster-health verifier.
 *
 * Usage:
 *   pnpm --filter @askarthur/web tsx scripts/verify-reddit-intel-cluster-health.ts
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, or
 * NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, in the environment.
 * Read-only: selects from reddit_intel_themes and reddit_post_intel_themes.
 */

import "dotenv/config";

import { verifyRedditIntelClusterHealth } from "@askarthur/scam-engine/reddit-intel-cluster-health";
import { createServiceClient } from "@askarthur/supabase/server";

async function main() {
  const supabase = createServiceClient();
  if (!supabase) {
    console.error(
      "Supabase service client unavailable. Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    process.exit(1);
  }

  const report = await verifyRedditIntelClusterHealth(supabase);

  console.log(report.evidence);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("[reddit-intel-cluster-health] fatal:", err);
  process.exit(1);
});

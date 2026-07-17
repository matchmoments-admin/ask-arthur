/**
 * Seed one fake FLAGGED image_check_records row (image-check v2, ADR-0022).
 *
 * Why: the evidence page (/image-check/[ref]) and its PDF only render for a
 * flagged check, which normally requires a live HIVE_API_KEY and a genuinely
 * AI-generated image. This lets you test the whole evidence surface — page,
 * PDF, and the /api/v1/image-checks feed — before the Hive contract lands.
 *
 * The row is metadata-only, exactly like the real write path: no image bytes,
 * install id as a hash. Safe to run against prod (it inserts one obviously
 * synthetic row and prints the DELETE to undo it).
 *
 * Usage (from repo root):
 *   pnpm --filter @askarthur/web seed:image-check
 *   pnpm --filter @askarthur/web seed:image-check --clean   # remove seeded rows
 */
import { loadEnv, requireEnv } from "./_load-env";
import { createClient } from "@supabase/supabase-js";
import { generateCheckRef } from "../lib/check-ref";

loadEnv();
requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Marks every seeded row so --clean can find them and so nobody mistakes one
// for a real detection in the B2B feed.
const SEED_MARKER = "seed-local-dev";

async function clean(): Promise<void> {
  const { error, count } = await supabase
    .from("image_check_records")
    .delete({ count: "exact" })
    .eq("install_id_hash", SEED_MARKER);
  if (error) {
    console.error("clean failed:", error.message);
    process.exit(1);
  }
  console.log(`🧹 removed ${count ?? 0} seeded row(s)`);
}

async function seed(): Promise<void> {
  const checkRef = generateCheckRef();
  const row = {
    check_ref: checkRef,
    install_id_hash: SEED_MARKER,
    image_url: "https://example.com/seeded-dev-image.jpg",
    page_url: "https://example.com/feed",
    image_sha256: "de".repeat(32),
    ai_confidence: 0.97,
    deepfake_confidence: 0.93,
    generator_source: "midjourney",
    generator_breakdown: [
      { class: "midjourney", score: 0.62 },
      { class: "dalle", score: 0.21 },
      { class: "flux", score: 0.08 },
    ],
    content_credentials: { present: true, format: "jpeg" },
    vision_summary:
      "[SEEDED DEV ROW] Appears to show an Australian public figure endorsing a cryptocurrency investment platform, a known celebrity-endorsement scam pattern.",
    impersonated_brand: "Example Invest",
    impersonated_celebrity: "Gina Rinehart",
    hive_result: { seeded: true },
  };

  const { error } = await supabase.from("image_check_records").insert(row);
  if (error) {
    console.error("seed failed:", error.message);
    process.exit(1);
  }

  const base = process.env.EXT_DEV_BASE ?? "http://localhost:3000";
  console.log(`\n✅ seeded flagged record ${checkRef}\n`);
  console.log(`   evidence page : ${base}/image-check/${checkRef}`);
  console.log(`   evidence PDF  : ${base}/api/image-check/${checkRef}/pdf`);
  console.log(`   B2B feed      : ${base}/api/v1/image-checks  (needs an API key)`);
  console.log(
    `\n   Both surfaces need NEXT_PUBLIC_FF_IMAGE_CHECK=true and FF_IMAGE_CHECK_RECORDS=true,`,
  );
  console.log(`   otherwise they 404 by design.\n`);
  console.log(`   undo: pnpm --filter @askarthur/web seed:image-check --clean\n`);
}

async function main(): Promise<void> {
  if (process.argv.includes("--clean")) {
    await clean();
    return;
  }
  await seed();
}

main().catch((err) => {
  console.error("seed error:", err);
  process.exit(1);
});

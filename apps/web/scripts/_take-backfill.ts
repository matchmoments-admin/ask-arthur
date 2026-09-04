/**
 * Arthur's Take — operator backfill.
 *
 *   pnpm --filter @askarthur/web tsx scripts/_take-backfill.ts [count] [--dry]
 *
 * Writes takes for rows that already have intelligence. The live Inngest step
 * only covers posts classified in the SAME run (~40/day), so without this the
 * 4,313 existing rows would never get one and the feed would show takes on a
 * thin trickle of new items only.
 *
 * Uses the same module as the live path — generateTakesForPosts — so there is
 * one implementation of what a take is, and this script cannot drift into a
 * second opinion about validation or column mapping.
 *
 * Guards, deliberately the same ones the Inngest step has:
 *   - needsTake() skips any row that already carries a decision, so re-running
 *     is free and cannot double-pay.
 *   - the shared feature_brakes.reddit_intel key is checked first, so a day
 *     that has already tripped the cost cap cannot be topped up by hand.
 *   - batches are bounded and the count is an explicit argument, so the spend
 *     is chosen rather than discovered.
 *
 * At ~US$0.0011 a take, 100 rows is about eleven cents.
 */
import "./_load-env-config";

import { createServiceClient } from "@askarthur/supabase/server";
import { isFeatureBraked, logCost } from "@askarthur/scam-engine/cost-log";
import {
  generateTakesForPosts,
  needsTake,
  type IntelRowForTake,
} from "@askarthur/scam-engine/reddit-intel/takes";

const COUNT = Number(process.argv[2] ?? 25);
const DRY = process.argv.includes("--dry");
const BATCH = 25; // one Claude call per batch; matches the live step's shape

async function main() {
  const supabase = createServiceClient();
  if (!supabase) throw new Error("no supabase service client");

  if (await isFeatureBraked("reddit_intel")) {
    console.log("feature_brakes.reddit_intel is engaged — refusing to spend.");
    return;
  }

  const { data, error } = await supabase
    .from("reddit_post_intel")
    .select(
      "id, feed_item_id, intent_label, confidence, modus_operandi, narrative_summary, tactic_tags, brands_impersonated, country_hints, is_emerging, is_scam_report, take_status, feed_items(description, body_md, published, source)",
    )
    .eq("take_status", "none")
    .order("processed_at", { ascending: false })
    .limit(COUNT);

  if (error) throw new Error(error.message);

  const candidates = (data ?? []).filter((r) => {
    const fi = r.feed_items as unknown as {
      published: boolean | null;
      source: string | null;
    } | null;
    // Never spend on a row the public surfaces would not render anyway.
    return (
      needsTake({ takeStatus: r.take_status as string | null }) &&
      fi?.published === true &&
      fi?.source === "reddit"
    );
  });

  console.log(
    `${candidates.length} rows need a take (asked for ${COUNT})${DRY ? " — DRY, no writes" : ""}`,
  );
  if (candidates.length === 0) return;

  let ready = 0;
  let suppressed = 0;
  let failed = 0;
  let spend = 0;

  for (let i = 0; i < candidates.length; i += BATCH) {
    const slice = candidates.slice(i, i + BATCH);
    const inputs: IntelRowForTake[] = slice.map((r) => {
      const fi = r.feed_items as unknown as {
        description: string | null;
        body_md: string | null;
      };
      return {
        intelId: r.id as string,
        feedItemId: r.feed_item_id as number,
        intentLabel: r.intent_label as IntelRowForTake["intentLabel"],
        confidence: Number(r.confidence),
        modusOperandi: r.modus_operandi as string | null,
        narrativeSummary: r.narrative_summary as string | null,
        tacticTags: (r.tactic_tags as string[]) ?? [],
        brandsImpersonated: (r.brands_impersonated as string[]) ?? [],
        countryHints: (r.country_hints as string[]) ?? [],
        isEmerging: Boolean(r.is_emerging),
        isScamReport: (r.is_scam_report as boolean | null) ?? null,
        sourceText: fi?.body_md ?? fi?.description ?? "",
      };
    });

    const out = await generateTakesForPosts(inputs);
    spend += out.estimatedCostUsd;

    // Log to cost_telemetry under the SAME tag the live path uses. An operator
    // script that spends real money and records nothing is invisible to the
    // brake, to /admin/costs and to the weekly digest — which is the exact
    // "unmetered spend" gap that had to be fixed for the Inngest step. The
    // metadata marks it as a backfill so the two sources can be told apart.
    if (!DRY) {
      await logCost({
        feature: "reddit-intel-take",
        provider: "anthropic",
        operation: "messages.create",
        units: out.inputTokens + out.outputTokens,
        estimatedCostUsd: out.estimatedCostUsd,
        metadata: {
          model: out.modelId,
          posts: inputs.length,
          ready: out.readyCount,
          suppressed: out.suppressedCount,
          via: "backfill_script",
        },
      });
    }

    for (const t of out.results) {
      if (t.takeStatus === "ready") ready += 1;
      else if (t.takeStatus === "suppressed") suppressed += 1;
      else failed += 1;

      if (DRY) continue;
      const { error: upErr } = await supabase
        .from("reddit_post_intel")
        .update({
          take_status: t.takeStatus,
          take_suppressed_reason: t.takeSuppressedReason,
          take_tells: t.takeTells,
          take_where: t.takeWhere,
          take_au_line: t.takeAuLine,
          take_model_version: t.takeModelVersion,
          take_prompt_version: t.takePromptVersion,
          take_written_at: new Date().toISOString(),
        })
        .eq("id", t.intelId);
      if (upErr) console.error(`update ${t.intelId}: ${upErr.message}`);
    }

    console.log(
      `  batch ${i / BATCH + 1}: ready ${out.readyCount} · suppressed ${out.suppressedCount} · US$${out.estimatedCostUsd.toFixed(4)}`,
    );
  }

  console.log(
    `\ntotal — ready ${ready} · suppressed ${suppressed} · failed ${failed} · US$${spend.toFixed(4)}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

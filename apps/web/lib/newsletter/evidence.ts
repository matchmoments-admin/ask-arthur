import type { createServiceClient } from "@askarthur/supabase/server";
import type { NewsletterContent } from "./content";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";
import { takeIsPageWorthy } from "@/lib/feed";
type Client = NonNullable<ReturnType<typeof createServiceClient>>;

/** Recheck publication eligibility after preparation, before approval/send. */
export async function checkNewsletterEvidence(sb: Client, content: NewsletterContent) {
  for (const story of content.stories) {
    const [kind, rawId] = story.id.split(":");
    if (!/^\d+$/.test(rawId ?? "")) throw new Error("invalid_evidence_id");
    if (kind === "take") {
      const { data, error } = await sb.from("reddit_post_intel")
        .select("take_status,take_tells,confidence,is_scam_report,feed_items!inner(published,source,source_created_at)")
        .eq("feed_item_id", Number(rawId)).maybeSingle();
      const feed = data?.feed_items as unknown as { published: boolean; source: string; source_created_at: string } | undefined;
      if (error || !data || !feed || !feed.published || feed.source !== "reddit" || data.is_scam_report !== true ||
        new Date(feed.source_created_at).getTime() !== new Date(story.sourceDate).getTime() ||
        !takeIsPageWorthy({ takeStatus: data.take_status, tells: data.take_tells ?? [], confidence: data.confidence })) throw new Error("evidence_no_longer_eligible");
    } else if (kind === "feed") {
      const { data, error } = await sb.from("feed_items").select("published,source,url,published_at").eq("id", Number(rawId)).maybeSingle();
      if (error || !data?.published || !["scamwatch_alert", "acsc", "asic_investor"].includes(data.source) || data.url !== story.sourceUrl ||
        new Date(data.published_at).getTime() !== new Date(story.sourceDate).getTime()) throw new Error("evidence_no_longer_eligible");
    } else if (kind === "clone") {
      const { data, error } = await sb.from("shopfront_clone_alerts")
        .select("target_shop_id,source,alert_state,triage_status,inferred_target_domain,first_seen_at").eq("id", rawId).maybeSingle();
      if (error || !data || data.target_shop_id !== null || data.source !== "nrd" || data.alert_state !== "open" ||
        !["tp_confirmed", "tp_actioned"].includes(data.triage_status) || isFpBrand(data.inferred_target_domain) ||
        new Date(data.first_seen_at).getTime() !== new Date(story.sourceDate).getTime()) throw new Error("evidence_no_longer_eligible");
    } else throw new Error("invalid_evidence_id");
  }
}

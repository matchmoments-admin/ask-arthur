import type { createServiceClient } from "@askarthur/supabase/server";
import { newsletterWindow, safeEvidenceUrl, Story, type NewsletterStory } from "./content";
import { isFpBrand } from "@/lib/clone-watch/fp-brand-denylist";
import { takeIsPageWorthy, takeSlug } from "@/lib/feed";
type Client = NonNullable<ReturnType<typeof createServiceClient>>;

/** Uses existing public Arthur's Take output; no paid generation, private email
 * bodies or model-invented incident/trend counts enter this candidate list. */
export async function prepareNewsletter(sb: Client, now = new Date(), refresh = false) {
  const window = newsletterWindow(now);
  const existing = await sb.from("newsletter_issues").select("*").eq("window_start", window.start).maybeSingle();
  if (existing.error) throw new Error("issue_read_failed");
  if (existing.data && !refresh) return existing.data;
  if (existing.data && existing.data.status !== "draft") throw new Error("only_draft_sources_can_refresh");
  const [takes, regulators, clones] = await Promise.all([
    sb.from("reddit_post_intel").select("feed_item_id,narrative_summary,take_status,take_tells,take_where,take_au_line,confidence,country_hints,intent_label,feed_items!inner(title,source_created_at,published,source)")
      .eq("take_status", "ready").gte("confidence", 0.7).or("is_scam_report.is.null,is_scam_report.eq.true")
      .eq("feed_items.published", true).eq("feed_items.source", "reddit")
      .gte("feed_items.source_created_at", window.start).lt("feed_items.source_created_at", window.end)
      .order("feed_item_id", { ascending: false }).limit(200),
    sb.from("feed_items").select("id,title,url,published_at,source")
      .eq("published", true).in("source", ["scamwatch_alert", "acsc", "asic_investor"])
      .gte("published_at", window.start).lt("published_at", window.end)
      .order("published_at", { ascending: false }).limit(30),
    sb.from("shopfront_clone_alerts").select("id,candidate_domain,inferred_target_domain,first_seen_at")
      .is("target_shop_id", null).eq("source", "nrd").eq("alert_state", "open")
      .in("triage_status", ["tp_confirmed", "tp_actioned"])
      .gte("first_seen_at", window.start).lt("first_seen_at", window.end)
      .order("first_seen_at", { ascending: false }).limit(30),
  ]);
  const health = [
    { source: "arthurs_take", status: takes.error ? "failed" : "ok", sampled: (takes.data?.length ?? 0) === 200 },
    { source: "regulators", status: regulators.error ? "failed" : "ok", sampled: (regulators.data?.length ?? 0) === 30 },
    { source: "clone_watch", status: clones.error ? "failed" : "ok", sampled: (clones.data?.length ?? 0) === 30 },
    { source: "inbound", status: "private_research_only", sampled: false },
  ];
  if (takes.error || regulators.error || clones.error) throw new Error("newsletter_sources_unavailable");
  const candidates: NewsletterStory[] = [];
  const rows = (takes.data ?? []).sort((a, b) => Number((b.country_hints ?? []).includes("AU")) - Number((a.country_hints ?? []).includes("AU")));
  for (const row of rows) {
    const feed = row.feed_items as unknown as { title: string; source_created_at: string };
    const tells = (row.take_tells ?? []) as string[];
    if (!feed || !row.narrative_summary || !takeIsPageWorthy({ takeStatus: row.take_status, tells, confidence: row.confidence })) continue;
    candidates.push({
      id: `take:${row.feed_item_id}`, title: row.narrative_summary.split(/[.!?] /)[0].slice(0, 140), summary: row.narrative_summary.slice(0, 650),
      take: (row.take_au_line || row.take_where || "This is a reported experience, not an independently verified incident. Check the request through a channel you find yourself.").slice(0, 500),
      tells: tells.slice(0, 3).map(t => t.slice(0, 200)),
      action: "Pause before responding. Contact the organisation through its official app or a contact you found independently.",
      sourceLabel: "Arthur’s Take — Reddit discussion", sourceUrl: `https://askarthur.au/scam-feed/${takeSlug(row.feed_item_id, feed.title)}`,
      sourceDate: feed.source_created_at, jurisdiction: (row.country_hints ?? []).includes("AU") ? "Australia-tagged report" : "Location not established as Australian",
    });
  }
  for (const row of regulators.data ?? []) {
    if (!row.url || !safeEvidenceUrl(row.url)) continue;
    candidates.push({ id: `feed:${row.id}`, title: row.title.slice(0, 140), summary: "Read the regulator’s original alert and write a concise explanation before approving this issue.",
      take: "Add Arthur’s explanation of why this warning matters to readers.", tells: ["Add a specific recognition clue supported by the source."],
      action: "Add the safe next step recommended by the source.", sourceLabel: row.source,
      sourceUrl: row.url, sourceDate: row.published_at, jurisdiction: "Australian regulator",
    });
  }
  const cloneBrands = new Set<string>();
  for (const row of clones.data ?? []) {
    const brand = row.inferred_target_domain;
    if (!brand || isFpBrand(brand) || cloneBrands.has(brand)) continue;
    cloneBrands.add(brand);
    candidates.push({ id: `clone:${row.id}`, title: "A reviewed lookalike website to watch for",
      summary: `Our Clone Watch review identified ${row.candidate_domain} as a lookalike of ${brand}. A lookalike finding alone does not establish that a particular visitor lost money.`,
      take: "A familiar-looking web address is not proof you are on the organisation’s real website.",
      tells: ["Compare the complete domain, not just the logo or the brand name at the start."],
      action: "Open the brand’s website from a saved bookmark or an independently verified address before shopping or entering details.",
      sourceLabel: "Ask Arthur Clone Watch — operator reviewed", sourceUrl: "https://askarthur.au/clone-watch",
      sourceDate: row.first_seen_at, jurisdiction: "Ask Arthur monitored brands",
    });
  }
  const validCandidates = candidates.flatMap(candidate => {
    const parsed = Story.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
  if (existing.data) {
    const updated = await sb.from("newsletter_issues").update({ candidates: validCandidates, source_health: health, updated_at: new Date().toISOString() })
      .eq("id", existing.data.id).eq("revision", existing.data.revision).eq("status", "draft").select("*").maybeSingle();
    if (updated.error || !updated.data) throw new Error("issue_changed_reload");
    return updated.data;
  }
  // Save a draft even on a quiet week. An empty issue cannot pass approval.
  const content = { subject: "Arthur’s Watch — practical scam warnings", preheader: "What to watch for, how to spot it and what to do.", stories: validCandidates.slice(0, 1) };
  const saved = await sb.from("newsletter_issues").upsert({ window_start: window.start, window_end: window.end, content, candidates: validCandidates, source_health: health }, { onConflict: "window_start", ignoreDuplicates: true });
  if (saved.error) throw new Error("issue_prepare_failed");
  const result = await sb.from("newsletter_issues").select("*").eq("window_start", window.start).single();
  if (result.error) throw new Error("issue_read_failed");
  return result.data;
}

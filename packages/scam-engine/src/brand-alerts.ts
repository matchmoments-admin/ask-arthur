// Brand impersonation alert system — auto-creates alerts with draft social posts
// when Claude detects a known brand being impersonated in a scam.

import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { generateDraftPosts } from "./social-post";

export interface BrandAlertInput {
  brandName: string;
  scamType?: string | null;
  channel?: string | null;
  contentHash?: string;
  confidence: number;
  scammerPhones?: string[];
  scammerUrls?: string[];
  scammerEmails?: string[];
  summary?: string;
}

/**
 * Create a brand impersonation alert with draft social posts.
 * Called fire-and-forget from the analysis pipeline.
 */
export async function createBrandAlert(input: BrandAlertInput): Promise<void> {
  const supabase = createServiceClient();
  if (!supabase) return;

  // Look up brand category from known_brands table
  const { data: brand } = await supabase
    .from("known_brands")
    .select("brand_category, security_contact_email")
    .eq("brand_name", input.brandName)
    .single();

  // Generate draft social media posts
  const drafts = generateDraftPosts({
    brandName: input.brandName,
    scamType: input.scamType,
    channel: input.channel,
    summary: input.summary,
    scammerPhones: input.scammerPhones,
    scammerUrls: input.scammerUrls,
  });

  const { error } = await supabase
    .from("brand_impersonation_alerts")
    .insert({
      brand_name: input.brandName,
      brand_category: brand?.brand_category || null,
      scam_type: input.scamType || null,
      delivery_method: input.channel || null,
      scam_content_hash: input.contentHash || null,
      confidence_score: input.confidence,
      scammer_phones: input.scammerPhones || [],
      scammer_urls: input.scammerUrls || [],
      scammer_emails: input.scammerEmails || [],
      evidence_summary: input.summary || null,
      outreach_contact: brand?.security_contact_email || null,
      outreach_status: "pending",
      draft_post_short: drafts.short,
      draft_post_long: drafts.long,
    });

  if (error) {
    logger.error("Failed to create brand alert", { error: error.message, brand: input.brandName });
  } else {
    logger.info("Brand alert created with social draft", { brand: input.brandName });
  }
}

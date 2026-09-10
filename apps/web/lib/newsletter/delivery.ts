import type { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { signUnsubscribeUrl } from "@/lib/unsubscribe";
import { logCost, PRICING } from "@/lib/cost-telemetry";
import { checkNewsletterEvidence } from "./evidence";
import { IssueContent, safeProse } from "./content";

type Client = NonNullable<ReturnType<typeof createServiceClient>>;
export const UNSUBSCRIBE_MARKER = "https://askarthur.au/unsubscribe/NEWSLETTER_RECIPIENT_TOKEN";
export function newsletterCanSend() {
  return readStringEnv("VERCEL_ENV") === "production" &&
    readStringEnv("NEWSLETTER_SEND_ENABLED") === "true" && !!readStringEnv("RESEND_API_KEY");
}

export async function sendNewsletterBatch(sb: Client, id: string, revision: number) {
  if (!newsletterCanSend()) throw new Error("newsletter_send_disabled");
  const before = await sb.from("newsletter_issues").select("content").eq("id", id).single();
  if (before.error) throw new Error("issue_read_failed");
  await checkNewsletterEvidence(sb, IssueContent.parse(before.data.content));
  const start = await sb.rpc("start_newsletter_issue", { p_id: id, p_revision: revision });
  if (start.error) throw new Error("issue_not_ready_or_paused");
  const { data: issue, error } = await sb.from("newsletter_issues").select("*").eq("id", id).single();
  if (error || !issue?.rendered_html || !issue.rendered_text || !issue.sender) throw new Error("issue_read_failed");
  // Each invocation is bounded. A second click continues only pending recipients.
  // A lost response/receipt stays 'sending' and requires manual reconciliation;
  // it must not be retried after Resend's idempotency retention expires.
  for (let i = 0; i < 20; i++) {
    const claim = await sb.rpc("claim_newsletter_delivery", { p_id: id });
    if (claim.error) throw new Error("delivery_claim_failed");
    const recipient = claim.data?.[0];
    if (!recipient) break;
    if (!recipient.email) continue;
    const unsubscribe = signUnsubscribeUrl(recipient.email, "https://askarthur.au/unsubscribe");
    const oneClick = signUnsubscribeUrl(recipient.email, "https://askarthur.au/api/unsubscribe-one-click");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${readStringEnv("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": `newsletter/${id}/${recipient.subscriber_id}` },
      body: JSON.stringify({ from: issue.sender, to: [recipient.email], subject: safeProse(issue.content.subject),
        html: issue.rendered_html.replaceAll(UNSUBSCRIBE_MARKER, unsubscribe.replaceAll("&", "&amp;")),
        text: issue.rendered_text.replaceAll(UNSUBSCRIBE_MARKER, unsubscribe),
        headers: { "List-Unsubscribe": `<${unsubscribe}>, <${oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      }),
    });
    const receipt = await response.json().catch(() => null);
    if (!response.ok || typeof receipt?.id !== "string") throw new Error("delivery_requires_reconciliation");

    const recorded = await sb.from("newsletter_deliveries").update({ status: "accepted", provider_id: receipt.id }).eq("issue_id", id).eq("subscriber_id", recipient.subscriber_id).eq("status", "sending");
    if (recorded.error) throw new Error("delivery_requires_reconciliation");
    recordNewsletterCost("arthurs-watch", id, revision);
  }
  const remaining = await sb.from("newsletter_deliveries").select("status", { count: "exact", head: true }).eq("issue_id", id).in("status", ["pending", "sending"]);
  if (remaining.error) throw new Error("delivery_status_unavailable");
  if (remaining.count === 0) {
    const done = await sb.from("newsletter_issues").update({ status: "sent", updated_at: new Date().toISOString() }).eq("id", id).eq("status", "sending");
    if (done.error) throw new Error("delivery_status_unavailable");
  }
}

export function newsletterCanTest() {
  return readStringEnv("VERCEL_ENV") === "production" && !!readStringEnv("RESEND_API_KEY");
}

/** Explicit operator action only. Uses the saved approval render and a fixed
 * operator recipient; arbitrary recipient addresses are never accepted. */
export async function sendNewsletterTest(sb: Client, id: string, revision: number) {
  if (!newsletterCanTest()) throw new Error("newsletter_test_disabled");
  const current = await sb.from("newsletter_issues").select("*").eq("id", id).eq("revision", revision).eq("status", "approved").single();
  if (current.error || !current.data?.rendered_html || !current.data.rendered_text) throw new Error("issue_not_approved");
  const issue = current.data;
  await checkNewsletterEvidence(sb, IssueContent.parse(issue.content));
  const claim = await sb.rpc("claim_newsletter_test", { p_id: id, p_revision: revision });
  if (claim.error) throw new Error("newsletter_test_paused_or_unavailable");
  if (claim.data !== true) throw new Error("test_already_attempted_check_receipt");
  const email = readStringEnv("ADMIN_TEST_EMAIL") || "brendan@askarthur.au";
  const unsubscribe = signUnsubscribeUrl(email, "https://askarthur.au/unsubscribe");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${readStringEnv("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": `newsletter-test/${id}/${revision}` },
    body: JSON.stringify({ from: issue.sender, to: [email], subject: `[TEST] ${safeProse(issue.content.subject)}`,
      html: issue.rendered_html.replaceAll(UNSUBSCRIBE_MARKER, unsubscribe.replaceAll("&", "&amp;")),
      text: issue.rendered_text.replaceAll(UNSUBSCRIBE_MARKER, unsubscribe),
    }),
  });
  const receipt = await response.json().catch(() => null);
  if (!response.ok || typeof receipt?.id !== "string") throw new Error("test_requires_reconciliation");
  const recorded = await sb.from("newsletter_test_sends").update({ provider_id: receipt.id }).eq("issue_id", id).eq("revision", revision);
  if (recorded.error) throw new Error("test_requires_reconciliation");
  recordNewsletterCost("arthurs-watch-test", id, revision);
}

function recordNewsletterCost(operation: string, id: string, revision: number) {
  try {
    logCost({ feature: "newsletter_send", provider: "resend", operation, units: 1, unitCostUsd: PRICING.RESEND_USD_PER_EMAIL, metadata: { issue_id: id, revision } });
  } catch { logger.warn("newsletter_cost_record_failed", { issue_id: id, revision }); }
}

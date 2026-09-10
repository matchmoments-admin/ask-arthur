import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { render } from "@react-email/components";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { readStringEnv } from "@askarthur/utils/env";
import { logger } from "@askarthur/utils/logger";
import { prepareNewsletter } from "@/lib/newsletter/prepare";
import { approvalProblems, IssueContent, Story } from "@/lib/newsletter/content";
import { newsletterCanSend, newsletterCanTest, sendNewsletterTest, sendNewsletterBatch, UNSUBSCRIBE_MARKER } from "@/lib/newsletter/delivery";
import { checkNewsletterEvidence } from "@/lib/newsletter/evidence";
import ArthursWatch from "@/emails/ArthursWatch";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare") }),
  z.object({ action: z.literal("save"), id: z.uuid(), revision: z.number().int().positive(), content: IssueContent }),
  z.object({ action: z.literal("approve"), id: z.uuid(), revision: z.number().int().positive(), evidenceReviewed: z.literal(true) }),
  z.object({ action: z.literal("test"), id: z.uuid(), revision: z.number().int().positive() }),
  z.object({ action: z.literal("send"), id: z.uuid(), revision: z.number().int().positive(), inboxChecked: z.literal(true) }),
]);
export async function GET() {
  await requireAdmin();
  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  const { data, error } = await sb.from("newsletter_issues").select("*").order("created_at", { ascending: false }).limit(12);
  if (error) return NextResponse.json({ error: "issues_unavailable" }, { status: 503 });
  const result = [];
  for (const issue of data ?? []) {
    const content = IssueContent.safeParse(issue.content);
    const [total, accepted, pending, uncertain] = await Promise.all([
      sb.from("newsletter_deliveries").select("status", { count: "exact", head: true }).eq("issue_id", issue.id),
      ...["accepted", "pending", "sending"].map(status => sb.from("newsletter_deliveries").select("status", { count: "exact", head: true }).eq("issue_id", issue.id).eq("status", status)),
    ]);
    if ([total, accepted, pending, uncertain].some(r => r.error)) return NextResponse.json({ error: "delivery_status_unavailable" }, { status: 503 });
    const test = await sb.from("newsletter_test_sends").select("provider_id").eq("issue_id", issue.id).eq("revision", issue.revision).maybeSingle();
    if (test.error) return NextResponse.json({ error: "test_status_unavailable" }, { status: 503 });
    result.push({ ...issue, rendered_html: undefined, rendered_text: undefined,
      testAttempted: !!test.data, testAccepted: !!test.data?.provider_id,
      preview: issue.rendered_html ?? (content.success ? await render(ArthursWatch({ content: content.data })) : ""),
      deliveries: { total: total.count ?? 0, accepted: accepted.count ?? 0, pending: pending.count ?? 0, uncertain: uncertain.count ?? 0 },
    });
  }
  return NextResponse.json({ issues: result, canSend: newsletterCanSend(), canTest: newsletterCanTest(), testRecipient: readStringEnv("ADMIN_TEST_EMAIL") || "brendan@askarthur.au" }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  await requireAdmin();
  if (req.headers.get("origin") !== req.nextUrl.origin) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request", details: parsed.error.issues.map(i => i.message) }, { status: 400 });
  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "store_unavailable" }, { status: 503 });
  try {
    const body = parsed.data;
    if (body.action === "prepare") {
      const issue = await prepareNewsletter(sb);
      return NextResponse.json({ id: issue.id });
    }
    if (body.action === "test") {
      await sendNewsletterTest(sb, body.id, body.revision);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "send") {
      await sendNewsletterBatch(sb, body.id, body.revision);
      return NextResponse.json({ ok: true });
    }
    const current = await sb.from("newsletter_issues").select("*").eq("id", body.id).eq("revision", body.revision).in("status", ["draft", "approved"]).maybeSingle();
    if (current.error) throw new Error("issue_read_failed");
    if (!current.data) return NextResponse.json({ error: "issue_changed_reload" }, { status: 409 });
    const content = IssueContent.parse(body.action === "save" ? body.content : current.data.content);
    const candidates = z.array(Story).parse(current.data.candidates);
    const problems = approvalProblems(content, candidates);
    // Incomplete regulator copy may be saved, but evidence identity cannot change.
    const blocking = body.action === "approve" ? problems : problems.filter(p => p.startsWith("Source evidence"));
    if (blocking.length) return NextResponse.json({ error: "editorial_review_required", details: blocking }, { status: 400 });
    if (body.action === "approve") await checkNewsletterEvidence(sb, content);
    const values = body.action === "save" ? {
      content, revision: body.revision + 1, approved_revision: null, status: "draft", rendered_html: null, rendered_text: null, sender: null,
    } : {
      approved_revision: body.revision, status: "approved",
      rendered_html: await render(ArthursWatch({ content, unsubscribeUrl: UNSUBSCRIBE_MARKER })),
      rendered_text: await render(ArthursWatch({ content, unsubscribeUrl: UNSUBSCRIBE_MARKER }), { plainText: true }),
      sender: readStringEnv("RESEND_FROM_EMAIL") || "Ask Arthur <brendan@askarthur.au>",
    };
    const saved = await sb.from("newsletter_issues").update({ ...values, updated_at: new Date().toISOString() }).eq("id", body.id).eq("revision", body.revision).in("status", ["draft", "approved"]).select("id").maybeSingle();
    if (saved.error) throw new Error("issue_save_failed");
    if (!saved.data) return NextResponse.json({ error: "issue_changed_reload" }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.warn("newsletter_admin_action_failed", { reason: error instanceof Error ? error.message : "unknown" });
    return NextResponse.json({ error: "newsletter_action_failed", message: error instanceof Error ? error.message : "unknown" }, { status: 503 });
  }
}

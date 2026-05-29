import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, getAdminUserId } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";
import { EMAIL_TEMPLATES } from "@/lib/email/copy-registry";
import { clearEmailCopyCache } from "@/lib/email/resolve-copy";

export const dynamic = "force-dynamic";

const Body = z.object({
  templateKey: z.string().min(1).max(64),
  // slot_key -> markdown
  slots: z.record(z.string(), z.string().max(8000)),
});

// POST /api/admin/email-studio/save — upsert per-slot copy overrides + append
// an audit-history row per slot. Only slots the registry defines are accepted.
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const def = EMAIL_TEMPLATES[body.templateKey];
  if (!def || !def.editable) {
    return NextResponse.json({ error: "unknown_or_locked_template" }, { status: 400 });
  }
  // Reject any slot the registry doesn't define for this template.
  const unknown = Object.keys(body.slots).filter((s) => !(s in def.slots));
  if (unknown.length > 0) {
    return NextResponse.json(
      { error: "unknown_slot", slots: unknown },
      { status: 400 },
    );
  }

  const sb = createServiceClient();
  if (!sb) return NextResponse.json({ error: "supabase_unavailable" }, { status: 503 });
  const adminId = await getAdminUserId();
  const now = new Date().toISOString();

  const rows = Object.entries(body.slots).map(([slot_key, content_md]) => ({
    template_key: body.templateKey,
    slot_key,
    content_md,
    updated_by_admin_id: adminId,
    updated_at: now,
  }));

  const { error: upErr } = await sb
    .from("email_copy")
    .upsert(rows, { onConflict: "template_key,slot_key" });
  if (upErr) {
    logger.error("email-studio save: upsert failed", { error: upErr.message });
    return NextResponse.json({ error: "save_failed" }, { status: 500 });
  }

  // Append-only history (best-effort — don't fail the save if it errors).
  const { error: histErr } = await sb.from("email_copy_history").insert(
    Object.entries(body.slots).map(([slot_key, content_md]) => ({
      template_key: body.templateKey,
      slot_key,
      content_md,
      edited_by_admin_id: adminId,
    })),
  );
  if (histErr) {
    logger.warn("email-studio save: history insert failed", { error: histErr.message });
  }

  clearEmailCopyCache(body.templateKey);
  return NextResponse.json({ ok: true, saved: rows.length });
}

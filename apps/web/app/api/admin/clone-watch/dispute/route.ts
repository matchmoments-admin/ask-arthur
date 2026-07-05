import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { logger } from "@askarthur/utils/logger";

// Governance ledger for Clone Watch brand/registrar disputes (v194).
// Admin-only. POST logs a dispute; PATCH resolves one. Backs the correction
// process promised on /clone-watch/method.

export const dynamic = "force-dynamic";

const LogSchema = z.object({
  subjectType: z.enum(["brand", "registrar"]),
  subject: z.string().min(1).max(255),
  disputant: z.string().max(255).optional(),
  claim: z.string().min(1).max(4000),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

const ResolveSchema = z.object({
  id: z.string().uuid(),
  resolution: z.enum(["corrected", "upheld", "withdrawn"]),
  notes: z.string().max(4000).optional(),
});

export async function POST(req: Request) {
  await requireAdmin();
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const parsed = LogSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_dispute" }, { status: 400 });
  }
  const d = parsed.data;

  const { data, error } = await supabase
    .from("clone_watch_disputes")
    .insert({
      subject_type: d.subjectType,
      subject: d.subject,
      disputant: d.disputant ?? null,
      claim: d.claim,
      evidence: d.evidence ?? {},
    })
    .select("id")
    .single();

  if (error) {
    logger.error("clone-watch dispute log failed", { error: error.message });
    return NextResponse.json({ error: "log_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id }, { status: 201 });
}

export async function PATCH(req: Request) {
  await requireAdmin();
  const supabase = createServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: "service_unavailable" }, { status: 503 });
  }

  const parsed = ResolveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_resolution" }, { status: 400 });
  }
  const r = parsed.data;

  const { error } = await supabase
    .from("clone_watch_disputes")
    .update({
      resolution: r.resolution,
      notes: r.notes ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", r.id);

  if (error) {
    logger.error("clone-watch dispute resolve failed", { error: error.message });
    return NextResponse.json({ error: "resolve_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

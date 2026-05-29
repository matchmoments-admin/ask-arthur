import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { render } from "@react-email/components";
import { requireAdmin } from "@/lib/adminAuth";
import { buildPreviewElement } from "@/lib/email/preview-fixtures";

export const dynamic = "force-dynamic";

const Body = z.object({
  templateKey: z.string().min(1).max(64),
  // unsaved per-slot markdown overrides to preview (defaults apply otherwise)
  copy: z.record(z.string(), z.string()).optional(),
});

// POST /api/admin/email-studio/preview — render a template with sample data +
// the supplied (possibly-unsaved) copy, return HTML for an iframe preview.
export async function POST(req: NextRequest) {
  await requireAdmin();
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const el = buildPreviewElement(body.templateKey, body.copy);
  if (!el) {
    return NextResponse.json({ error: "unknown_template" }, { status: 404 });
  }
  const html = await render(el);
  return NextResponse.json({ html });
}

import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { EMAIL_TEMPLATES } from "@/lib/email/copy-registry";
import EmailStudio, { type StudioTemplate } from "./EmailStudio";

export const dynamic = "force-dynamic";

export default async function EmailStudioPage() {
  await requireAdmin();

  // Current saved overrides → { templateKey: { slotKey: content_md } }
  const overrides: Record<string, Record<string, string>> = {};
  const sb = createServiceClient();
  if (sb) {
    const { data } = await sb
      .from("email_copy")
      .select("template_key, slot_key, content_md");
    for (const r of data ?? []) {
      (overrides[r.template_key as string] ??= {})[r.slot_key as string] =
        r.content_md as string;
    }
  }

  // Serialise the registry to plain data for the client component.
  const templates: StudioTemplate[] = Object.values(EMAIL_TEMPLATES).map((t) => ({
    key: t.key,
    label: t.label,
    vars: t.vars,
    editable: t.editable,
    slots: Object.entries(t.slots).map(([key, s]) => ({
      key,
      label: s.label,
      default: s.default,
    })),
  }));

  return <EmailStudio templates={templates} overrides={overrides} />;
}

import { requireAdmin } from "@/lib/adminAuth";
import { PILOT_TEMPLATE_BODY } from "@/lib/email/brand-outreach";
import BrandOutreach from "./BrandOutreach";

export const dynamic = "force-dynamic";

// Admin surface for the founder-composed, one-off brand reach-out / pilot
// email. Auth-gated exactly like the other admin pages (HMAC cookie OR
// Supabase admin role via requireAdmin). The compose + send logic lives in
// the client component; the pilot starter body is passed in from the shared
// lib so the copy has a single source of truth.
export default async function BrandOutreachPage() {
  await requireAdmin();
  return <BrandOutreach pilotTemplate={PILOT_TEMPLATE_BODY} />;
}

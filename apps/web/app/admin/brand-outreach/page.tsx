import { requireAdmin } from "@/lib/adminAuth";
import { createServiceClient } from "@askarthur/supabase/server";
import { PILOT_TEMPLATE_BODY } from "@/lib/email/brand-outreach";
import BrandOutreach from "./BrandOutreach";
import BrandOnboardForm from "@/components/admin/BrandOnboardForm";

export const dynamic = "force-dynamic";

// Admin surface for the founder-composed, one-off brand reach-out / pilot
// email. Auth-gated exactly like the other admin pages (HMAC cookie OR
// Supabase admin role via requireAdmin). The compose + send logic lives in
// the client component; the pilot starter body is passed in from the shared
// lib so the copy has a single source of truth.
export default async function BrandOutreachPage() {
  await requireAdmin();

  // Onboarding lives HERE, not on /admin/brand-register (flag-gated OFF, so it
  // 404s) — a pilot converts on this page, so the "they said yes" form belongs
  // in the same flow as the pitch (#953). monitored_brands was empty when the
  // first five pilot emails went out on 2026-08-08.
  const sb = createServiceClient();
  let org: { id: string; name: string } | null = null;
  let monitoredCount = 0;
  if (sb) {
    const [{ data: orgRow }, { count }] = await Promise.all([
      sb.from("organizations").select("id, name").order("created_at").limit(1).maybeSingle(),
      sb.from("monitored_brands").select("id", { count: "exact", head: true }),
    ]);
    org = (orgRow as { id: string; name: string } | null) ?? null;
    monitoredCount = count ?? 0;
  }

  return (
    <>
      <BrandOutreach pilotTemplate={PILOT_TEMPLATE_BODY} />
      <section className="mx-auto mt-10 max-w-4xl px-5 pb-12">
        <h2 className="text-deep-navy text-lg font-extrabold">They said yes — onboard the brand</h2>
        <p className="mt-1 text-sm text-gov-slate">
          Creates the <code className="font-mono text-xs">monitored_brands</code> row that turns
          clone-watch detections into a monitored brand.{" "}
          {monitoredCount === 0
            ? "No brands are monitored yet — this would be the first."
            : `${monitoredCount} brand${monitoredCount === 1 ? "" : "s"} monitored.`}
        </p>
        {org ? (
          <BrandOnboardForm orgId={org.id} orgName={org.name} />
        ) : (
          <p className="mt-3 text-sm text-danger-text">
            No organisation row found — create one before onboarding a brand.
          </p>
        )}
      </section>
    </>
  );
}

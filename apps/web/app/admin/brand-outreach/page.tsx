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
  let orgs: Array<{ id: string; name: string }> = [];
  let monitoredCount = 0;
  let loadFailed = false;
  if (sb) {
    const [{ data: orgRows, error: orgErr }, { count, error: countErr }] = await Promise.all([
      // ALL orgs, not organizations[0]: silently binding every pilot to
      // whichever org happens to be oldest files a paying customer's brand
      // under our own org, where their users can never read it (v207 RLS).
      sb.from("organizations").select("id, name").order("name"),
      sb.from("monitored_brands").select("id", { count: "exact", head: true }),
    ]);
    orgs = (orgRows as Array<{ id: string; name: string }> | null) ?? [];
    monitoredCount = count ?? 0;
    // Without this, a failed query renders "No brands are monitored yet" or
    // "No organisation row found" — affirmative claims on a failure path.
    loadFailed = Boolean(orgErr || countErr);
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
        {loadFailed && (
          <p className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            Couldn&rsquo;t read the org / monitored-brand data — the counts above are not
            measurements. Reload before onboarding anything.
          </p>
        )}
        <BrandOnboardForm orgs={orgs} />
      </section>
    </>
  );
}

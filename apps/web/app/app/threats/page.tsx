import { requireAuth } from "@/lib/auth";
import { getRecentThreats } from "@/lib/dashboard";
import ThreatFeed from "@/components/dashboard/ThreatFeed";

export default async function ThreatsPage() {
  await requireAuth();
  const threats = await getRecentThreats(50);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-deep-navy">Threat Feed</h1>
        <p className="text-xs text-slate-500">
          All detected threat entities across scam reports, ordered by most recent activity.
        </p>
      </div>

      <ThreatFeed entities={threats} />
    </div>
  );
}

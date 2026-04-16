import { requireAuth } from "@/lib/auth";
import { getOrg } from "@/lib/org";
import { getEvidenceItems } from "@/lib/dashboard/compliance";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import EvidenceLog from "@/components/dashboard/compliance/EvidenceLog";

export default async function EvidenceExportPage() {
  const user = await requireAuth();
  const org = await getOrg(user.id);
  const orgId = org?.orgId ?? null;

  const evidence = await getEvidenceItems(orgId);

  const isDemo = !orgId;

  return (
    <div className="p-6 max-w-[1400px]">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-slate-400 mb-4">
        <Link
          href="/app/compliance"
          className="hover:text-trust-teal transition-colors"
        >
          Compliance
        </Link>
        <ChevronRight size={12} />
        <span className="text-deep-navy font-medium">Evidence Export</span>
      </nav>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">
          Evidence Export
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          {isDemo ? (
            <span>
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-medium text-amber-700 mr-1.5">
                Demo Mode
              </span>
              Showing sample evidence data.
            </span>
          ) : (
            <>
              {org?.orgName} — Export compliance evidence for regulatory
              submissions and audits.
            </>
          )}
        </p>
      </div>

      {/* Evidence Log (full width) */}
      <EvidenceLog items={evidence} />
    </div>
  );
}

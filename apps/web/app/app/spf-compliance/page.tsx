import { requireAuth } from "@/lib/auth";
import ComplianceChecklist from "@/components/dashboard/ComplianceChecklist";

export default async function SpfCompliancePage() {
  await requireAuth();

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">SPF Compliance</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Scams Prevention Framework Act 2025 compliance tracking and evidence.
        </p>
      </div>

      <div className="max-w-2xl">
        <ComplianceChecklist />
      </div>
    </div>
  );
}

import { requireAuth } from "@/lib/auth";
import { FileText } from "lucide-react";

export default async function ReportsPage() {
  await requireAuth();

  return (
    <div className="p-6 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-deep-navy">Reports & Exports</h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Generate intelligence reports and export threat data for government and compliance use.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { title: "Monthly Intelligence Report", desc: "PDF summary for APRA submissions", status: "Coming soon" },
          { title: "Threat Entity Export", desc: "CSV/JSON export of high-risk entities", status: "Coming soon" },
          { title: "STIX 2.1 Export", desc: "Machine-readable format for ACSC/CTIS", status: "Coming soon" },
          { title: "NASC Submission", desc: "Scamwatch taxonomy-formatted report", status: "Coming soon" },
          { title: "Jurisdiction Summary", desc: "Per-region aggregate for state police", status: "Coming soon" },
          { title: "Financial Impact Report", desc: "Loss estimates for risk committees", status: "Coming soon" },
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-slate-200/60 bg-white p-5">
            <FileText size={20} className="text-slate-300 mb-3" />
            <h3 className="text-sm font-medium text-deep-navy">{item.title}</h3>
            <p className="text-xs text-slate-400 mt-1">{item.desc}</p>
            <span className="inline-block mt-3 text-[10px] font-medium uppercase tracking-wider text-slate-400 bg-slate-50 px-2 py-1 rounded">
              {item.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

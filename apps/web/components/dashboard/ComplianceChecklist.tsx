import { CheckCircle2, Clock, Circle } from "lucide-react";

interface ComplianceItem {
  id: string;
  title: string;
  description: string;
  status: "complete" | "in-progress" | "not-started";
  category: string;
}

const ITEMS: ComplianceItem[] = [
  {
    id: "scamwatch-taxonomy",
    title: "Scamwatch taxonomy alignment",
    description: "Scam types mapped to NASC 11-category taxonomy",
    status: "complete",
    category: "Data",
  },
  {
    id: "entity-enrichment",
    title: "Entity enrichment pipeline",
    description: "WHOIS, SSL, phone, IP enrichment running",
    status: "in-progress",
    category: "Intel",
  },
  {
    id: "monthly-report",
    title: "Monthly intelligence report",
    description: "Auto-generated PDF for APRA submissions",
    status: "not-started",
    category: "Compliance",
  },
  {
    id: "nasc-pipeline",
    title: "NASC submission pipeline",
    description: "Automated reporting to National Anti-Scam Centre",
    status: "not-started",
    category: "Gov",
  },
  {
    id: "afcx-export",
    title: "AFCX Intel Loop export",
    description: "STIX 2.1 format for financial sector sharing",
    status: "not-started",
    category: "Gov",
  },
  {
    id: "apra-cps230",
    title: "APRA CPS 230 audit log",
    description: "Operational resilience evidence for regulators",
    status: "in-progress",
    category: "Compliance",
  },
];

const STATUS_ICONS = {
  "complete": <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />,
  "in-progress": <Clock size={16} className="text-amber-500 shrink-0" />,
  "not-started": <Circle size={16} className="text-slate-300 shrink-0" />,
};

const STATUS_LABELS: Record<string, string> = {
  "complete": "Done",
  "in-progress": "Active",
  "not-started": "Pending",
};

export default function ComplianceChecklist() {
  const completed = ITEMS.filter((i) => i.status === "complete").length;

  return (
    <div className="rounded-lg border border-slate-200/60 bg-white">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 className="text-sm font-semibold text-deep-navy">SPF Compliance</h3>
        <span
          className="text-xs text-slate-500"
          style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
        >
          {completed}/{ITEMS.length}
        </span>
      </div>

      {/* Progress bar */}
      <div className="px-5 pt-3">
        <div className="h-1.5 w-full rounded-full bg-slate-100">
          <div
            className="h-1.5 rounded-full bg-emerald-500 transition-all"
            style={{ width: `${(completed / ITEMS.length) * 100}%` }}
          />
        </div>
      </div>

      <ul className="divide-y divide-slate-100/80 mt-2">
        {ITEMS.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-5 py-3">
            {STATUS_ICONS[item.status]}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-deep-navy">{item.title}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">{item.description}</p>
            </div>
            <span className="shrink-0 rounded-full bg-[#EFF4F8] px-2 py-0.5 text-[9px] font-medium text-slate-500 uppercase tracking-wider">
              {item.category}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

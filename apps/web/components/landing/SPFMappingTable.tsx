import {
  ShieldCheck,
  Search,
  FileText,
  Zap,
  HeartHandshake,
  ClipboardCheck,
} from "lucide-react";
import type { ReactNode } from "react";

interface SPFRow {
  principle: string;
  obligation: string;
  capability: string;
  icon: ReactNode;
}

const rows: SPFRow[] = [
  {
    principle: "Prevent",
    obligation: "Proactive scam prevention measures",
    capability: "AI-powered threat detection via Threat API",
    icon: <ShieldCheck size={18} className="text-trust-teal" />,
  },
  {
    principle: "Detect",
    obligation: "Identify scam-related activity",
    capability: "Real-time URL, phone, email, domain analysis",
    icon: <Search size={18} className="text-trust-teal" />,
  },
  {
    principle: "Report",
    obligation: "Share intelligence with authorities",
    capability: "Automated ACCC/ASIC-ready reporting",
    icon: <FileText size={18} className="text-trust-teal" />,
  },
  {
    principle: "Disrupt",
    obligation: "Take action to stop scams",
    capability: "Cross-ecosystem intelligence sharing",
    icon: <Zap size={18} className="text-trust-teal" />,
  },
  {
    principle: "Respond",
    obligation: "Support affected customers",
    capability: "Incident response audit trail",
    icon: <HeartHandshake size={18} className="text-trust-teal" />,
  },
  {
    principle: "Govern",
    obligation: "Document policies and procedures",
    capability: "Compliance dashboard with exportable evidence",
    icon: <ClipboardCheck size={18} className="text-trust-teal" />,
  },
];

export default function SPFMappingTable() {
  return (
    <section className="mb-16">
      <h2 className="text-deep-navy text-2xl font-extrabold mb-2">
        SPF Act Compliance Mapping
      </h2>
      <p className="text-gov-slate text-base mb-6">
        How Ask Arthur maps to the six principles of the Scam Prevention
        Framework Act 2025.
      </p>

      <div className="overflow-x-auto rounded-2xl border border-border-light">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="bg-deep-navy text-white">
              <th className="px-4 py-3 font-semibold rounded-tl-2xl">
                SPF Principle
              </th>
              <th className="px-4 py-3 font-semibold">Obligation</th>
              <th className="px-4 py-3 font-semibold rounded-tr-2xl">
                Ask Arthur Capability
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.principle}
                className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}
              >
                <td className="px-4 py-3 font-semibold text-deep-navy">
                  <span className="inline-flex items-center gap-2">
                    {row.icon}
                    {row.principle}
                  </span>
                </td>
                <td className="px-4 py-3 text-gov-slate">{row.obligation}</td>
                <td className="px-4 py-3 text-gov-slate">{row.capability}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

"use client";

import { useState } from "react";
import { Siren, ChevronUp, ChevronDown } from "lucide-react";
import type { RecoverySteps } from "@/lib/recoverySteps";

interface RecoveryGuideProps {
  recovery: RecoverySteps;
  verdict: "SUSPICIOUS" | "HIGH_RISK";
}

export default function RecoveryGuide({ recovery, verdict }: RecoveryGuideProps) {
  const [expanded, setExpanded] = useState(verdict === "HIGH_RISK");

  return (
    <div className="mt-5 rounded-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between hover:bg-slate-100 transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Siren className="text-deep-navy" size={18} />
          <h3 className="text-xs font-bold uppercase tracking-widest text-deep-navy">
            Recovery Guidance
          </h3>
        </div>
        {expanded ? <ChevronUp className="text-gov-slate" size={18} /> : <ChevronDown className="text-gov-slate" size={18} />}
      </button>

      {expanded && (
        <div className="px-6 py-5 bg-white space-y-5">
          {recovery.sections.map((section, i) => (
            <div key={i}>
              <div className="flex items-center gap-2 mb-2">
                <section.icon className="text-deep-navy" size={16} />
                <h4 className="text-sm font-bold text-deep-navy">
                  {section.title}
                </h4>
              </div>
              <ul className="space-y-2 ml-6">
                {section.items.map((item, j) => (
                  <li
                    key={j}
                    className="flex items-start gap-2 text-sm text-gov-slate leading-relaxed"
                  >
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-slate-400" />
                    <span>
                      {item.text}
                      {item.contactLabel && (
                        <>
                          {" \u2014 "}
                          <span className="font-bold text-deep-navy">
                            {item.contactLabel}
                          </span>
                        </>
                      )}
                      {item.contact && (
                        <>
                          {" "}
                          <a
                            href={item.contact}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#008A98] underline hover:text-[#007080]"
                          >
                            Visit site
                          </a>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

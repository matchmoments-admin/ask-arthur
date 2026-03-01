"use client";

import { useState } from "react";
import { ChevronDown, FileCode } from "lucide-react";

interface AuditRawHeadersProps {
  rawHeaders: Record<string, string> | null;
}

const SECURITY_HEADERS = new Set([
  "strict-transport-security",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "permissions-policy",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
  "access-control-allow-origin",
  "x-xss-protection",
]);

export default function AuditRawHeaders({ rawHeaders }: AuditRawHeadersProps) {
  const [open, setOpen] = useState(false);

  if (!rawHeaders || Object.keys(rawHeaders).length === 0) return null;

  const entries = Object.entries(rawHeaders).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-3 bg-slate-50 border-b border-gray-200 flex items-center justify-between cursor-pointer hover:bg-slate-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <FileCode size={16} className="text-deep-navy" />
          <h3 className="text-sm font-bold text-deep-navy uppercase tracking-widest">
            Raw Headers
          </h3>
          <span className="text-xs text-gov-slate">
            ({entries.length} headers)
          </span>
        </div>
        <ChevronDown
          size={16}
          className={`text-gov-slate transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="p-2 overflow-x-auto">
          <table className="w-full text-xs">
            <tbody>
              {entries.map(([name, value]) => {
                const isSecurityHeader = SECURITY_HEADERS.has(
                  name.toLowerCase()
                );
                return (
                  <tr
                    key={name}
                    className={
                      isSecurityHeader ? "bg-teal-50/60" : "even:bg-slate-50/40"
                    }
                  >
                    <td className="px-3 py-1.5 font-bold text-deep-navy whitespace-nowrap align-top">
                      {name}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-gov-slate break-all">
                      {value}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

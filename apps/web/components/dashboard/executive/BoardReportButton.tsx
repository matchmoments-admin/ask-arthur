"use client";

import { FileText } from "lucide-react";

export default function BoardReportButton() {
  return (
    <button
      type="button"
      onClick={() => alert("PDF export coming soon")}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border-light bg-white text-sm font-medium text-deep-navy hover:bg-slate-50 transition-colors shadow-sm"
    >
      <FileText size={14} className="text-slate-400" />
      Generate Board Report
    </button>
  );
}

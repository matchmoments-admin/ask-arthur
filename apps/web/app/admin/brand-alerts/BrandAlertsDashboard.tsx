"use client";

import { useState, useMemo } from "react";
import { Send, Clock, BarChart3, FileText } from "lucide-react";

interface BrandAlert {
  id: number;
  brand_name: string;
  brand_category: string | null;
  scam_type: string | null;
  delivery_method: string | null;
  confidence_score: number | null;
  evidence_summary: string | null;
  outreach_status: string;
  created_at: string;
}

export default function BrandAlertsDashboard({
  initialAlerts,
  totalChecks,
}: {
  initialAlerts: Array<Record<string, unknown>>;
  totalChecks: number;
}) {
  const alerts = initialAlerts as unknown as BrandAlert[];
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [draftShort, setDraftShort] = useState("");
  const [draftLong, setDraftLong] = useState("");
  const [publishing, setPublishing] = useState(false);

  // Aggregate by brand
  const brandCounts = useMemo(() => {
    const map = new Map<string, { count: number; category: string | null }>();
    for (const a of alerts) {
      const existing = map.get(a.brand_name) || { count: 0, category: a.brand_category };
      map.set(a.brand_name, { count: existing.count + 1, category: existing.category });
    }
    return Array.from(map.entries())
      .map(([brand, { count, category }]) => ({ brand, count, category }))
      .sort((a, b) => b.count - a.count);
  }, [alerts]);

  // Aggregate by delivery method
  const deliveryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of alerts) {
      const method = a.delivery_method || "unknown";
      map.set(method, (map.get(method) || 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [alerts]);

  const topMethod = deliveryCounts[0];
  const topMethodPct = topMethod ? Math.round((topMethod[1] / alerts.length) * 100) : 0;

  // Generate weekly summary draft
  const generateDraft = () => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const period = `${weekAgo.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${now.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

    const topBrands = brandCounts.slice(0, 3);
    const brandTags = topBrands.map((b) => `${b.brand} (${b.count})`).join(", ");

    const short = `🚨 Weekly Scam Intelligence — ${period}\n\n📊 ${alerts.length} brand impersonation alerts\n🏦 Most targeted: ${brandTags}\n📱 ${topMethod?.[0] || "SMS"} is #1 method (${topMethodPct}%)\n\n🔍 Free scam checker: askarthur.au\n\n#ScamAlert #Australia #AskArthur`;

    const brandLines = brandCounts.slice(0, 8).map((b, i) => `${i + 1}. ${b.brand} — ${b.count} scam${b.count !== 1 ? "s" : ""} detected`);

    const long = `🚨 Ask Arthur Weekly Scam Intelligence Report\n📅 ${period}\n\nThis week, Ask Arthur analysed ${totalChecks.toLocaleString()} suspicious messages and detected ${alerts.length} brand impersonation scams targeting Australians.\n\n📊 Most Impersonated Brands:\n${brandLines.join("\n")}\n\n📱 Primary delivery method: ${topMethod?.[0] || "SMS"} (${topMethodPct}% of attacks)\n\n🛡️ How to protect yourself:\n• Never click links in unexpected messages\n• Verify directly via official websites or apps\n• Report to Scamwatch: scamwatch.gov.au\n• Check any message free at askarthur.au\n\n#ScamAlert #CyberSecurity #Australia #AskArthur`;

    setDraftShort(short.slice(0, 280));
    setDraftLong(long);
    setShowDraftModal(true);
  };

  const handlePublish = async () => {
    setPublishing(true);
    try {
      await fetch("/api/admin/brand-alerts/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alertId: 0, shortText: draftShort, longText: draftLong }),
      });
      setShowDraftModal(false);
    } catch {
      // silent
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      {/* Summary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Total Alerts</p>
          <p className="text-2xl font-bold text-deep-navy" style={{ fontVariantNumeric: "tabular-nums" }}>{alerts.length}</p>
        </div>
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Brands Targeted</p>
          <p className="text-2xl font-bold text-deep-navy" style={{ fontVariantNumeric: "tabular-nums" }}>{brandCounts.length}</p>
        </div>
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Top Method</p>
          <p className="text-lg font-bold text-deep-navy">{topMethod?.[0] || "—"} ({topMethodPct}%)</p>
        </div>
        <div className="bg-white border border-border-light rounded-xl shadow-sm p-4">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Checks (7d)</p>
          <p className="text-2xl font-bold text-deep-navy" style={{ fontVariantNumeric: "tabular-nums" }}>{totalChecks.toLocaleString()}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3 mb-6">
        <button
          onClick={generateDraft}
          disabled={alerts.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-deep-navy text-white text-sm font-medium rounded-lg hover:bg-navy transition-colors disabled:opacity-40"
        >
          <Send size={14} />
          Generate Weekly Post
        </button>
        <button
          disabled
          className="flex items-center gap-2 px-4 py-2 border border-border-light text-gov-slate text-sm font-medium rounded-lg opacity-50 cursor-not-allowed"
        >
          <FileText size={14} />
          Generate Brand Report (coming soon)
        </button>
      </div>

      {/* Brand table */}
      {alerts.length === 0 ? (
        <div className="text-center py-16 text-slate-400 text-sm">
          No brand alerts yet. Alerts are created when scam submissions detect brand impersonation.
        </div>
      ) : (
        <div className="bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
            <BarChart3 size={14} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-deep-navy">Brand Breakdown</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {brandCounts.map((b) => (
              <div key={b.brand} className="flex items-center justify-between px-5 py-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-deep-navy">{b.brand}</span>
                  {b.category && (
                    <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wider">
                      {b.category}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-24 h-1.5 bg-slate-100 rounded-full">
                    <div
                      className="h-1.5 bg-deep-navy rounded-full"
                      style={{ width: `${(b.count / (brandCounts[0]?.count || 1)) * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-slate-500 w-8 text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {b.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Draft Modal */}
      {showDraftModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-deep-navy">Weekly Social Post Draft</h2>
              <p className="text-xs text-slate-400 mt-0.5">Edit and publish to Twitter, LinkedIn, and Facebook</p>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Twitter/X ({draftShort.length}/280)</p>
                <textarea
                  value={draftShort}
                  onChange={(e) => setDraftShort(e.target.value)}
                  maxLength={280}
                  rows={5}
                  className="w-full border border-border-light rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-deep-navy"
                />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">LinkedIn / Facebook</p>
                <textarea
                  value={draftLong}
                  onChange={(e) => setDraftLong(e.target.value)}
                  rows={12}
                  className="w-full border border-border-light rounded-lg p-3 text-sm resize-y focus:outline-none focus:border-deep-navy"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setShowDraftModal(false)} className="px-4 py-2 text-sm text-slate-500">
                Cancel
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing}
                className="flex items-center gap-2 px-4 py-2 bg-deep-navy text-white text-sm font-medium rounded-lg hover:bg-navy transition-colors disabled:opacity-40"
              >
                {publishing ? <Clock size={14} className="animate-spin" /> : <Send size={14} />}
                Publish to All Platforms
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

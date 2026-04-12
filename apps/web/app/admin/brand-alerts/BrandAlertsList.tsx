"use client";

import { useState } from "react";
import { Send, X, CheckCircle2, Clock, Eye } from "lucide-react";

interface BrandAlert {
  id: number;
  brand_name: string;
  brand_category: string | null;
  scam_type: string | null;
  delivery_method: string | null;
  confidence_score: number | null;
  evidence_summary: string | null;
  outreach_status: string;
  draft_post_short: string | null;
  draft_post_long: string | null;
  twitter_post_id: string | null;
  linkedin_post_id: string | null;
  facebook_post_id: string | null;
  published_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-amber-100", text: "text-amber-800", label: "Draft" },
  sent: { bg: "bg-green-100", text: "text-green-800", label: "Published" },
  skipped: { bg: "bg-slate-100", text: "text-slate-500", label: "Skipped" },
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function BrandAlertsList({ initialAlerts }: { initialAlerts: Array<Record<string, unknown>> }) {
  const [alerts, setAlerts] = useState<BrandAlert[]>(initialAlerts as unknown as BrandAlert[]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editedShort, setEditedShort] = useState("");
  const [editedLong, setEditedLong] = useState("");
  const [publishing, setPublishing] = useState(false);

  const selected = alerts.find((a) => a.id === selectedId);

  const openReview = (alert: BrandAlert) => {
    setSelectedId(alert.id);
    setEditedShort(alert.draft_post_short || "");
    setEditedLong(alert.draft_post_long || "");
  };

  const handlePublish = async () => {
    if (!selectedId) return;
    setPublishing(true);

    try {
      const res = await fetch("/api/admin/brand-alerts/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alertId: selectedId,
          shortText: editedShort,
          longText: editedLong,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAlerts((prev) =>
          prev.map((a) =>
            a.id === selectedId
              ? { ...a, outreach_status: "sent", published_at: new Date().toISOString(), ...data }
              : a
          )
        );
        setSelectedId(null);
      }
    } catch {
      // Error handled silently
    } finally {
      setPublishing(false);
    }
  };

  const handleSkip = async () => {
    if (!selectedId) return;
    await fetch("/api/admin/brand-alerts/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alertId: selectedId }),
    });
    setAlerts((prev) =>
      prev.map((a) => (a.id === selectedId ? { ...a, outreach_status: "skipped" } : a))
    );
    setSelectedId(null);
  };

  return (
    <>
      {/* Alerts table */}
      <div className="bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
        <div className="divide-y divide-slate-100">
          {alerts.map((alert) => {
            const status = STATUS_BADGE[alert.outreach_status] || STATUS_BADGE.pending;
            return (
              <button
                key={alert.id}
                onClick={() => openReview(alert)}
                className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/50 transition-colors text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-deep-navy">{alert.brand_name}</span>
                    {alert.brand_category && (
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded uppercase tracking-wider">
                        {alert.brand_category}
                      </span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${status.bg} ${status.text}`}>
                      {status.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">
                    {alert.scam_type || "Unknown type"} via {alert.delivery_method || "unknown"} — {relativeTime(alert.created_at)}
                  </p>
                </div>
                <Eye size={16} className="text-slate-300 shrink-0" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Review modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl shadow-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-deep-navy">{selected.brand_name} Alert</h2>
              <button onClick={() => setSelectedId(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Evidence */}
              {selected.evidence_summary && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Evidence Summary</p>
                  <p className="text-sm text-gov-slate bg-slate-50 rounded-lg p-3">{selected.evidence_summary}</p>
                </div>
              )}

              {/* Twitter draft */}
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                  Twitter/X ({editedShort.length}/280)
                </p>
                <textarea
                  value={editedShort}
                  onChange={(e) => setEditedShort(e.target.value)}
                  maxLength={280}
                  rows={4}
                  className="w-full border border-border-light rounded-lg p-3 text-sm resize-none focus:outline-none focus:border-deep-navy"
                />
              </div>

              {/* LinkedIn/Facebook draft */}
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
                  LinkedIn / Facebook
                </p>
                <textarea
                  value={editedLong}
                  onChange={(e) => setEditedLong(e.target.value)}
                  rows={10}
                  className="w-full border border-border-light rounded-lg p-3 text-sm resize-y focus:outline-none focus:border-deep-navy"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-100">
              <button
                onClick={handleSkip}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handlePublish}
                disabled={publishing || !editedShort.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-deep-navy text-white text-sm font-medium rounded-lg hover:bg-navy transition-colors disabled:opacity-40"
              >
                {publishing ? (
                  <Clock size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Publish to All Platforms
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { createBrowserClient } from "@askarthur/supabase/browser";
import {
  Search,
  Download,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Globe,
  Phone,
  Mail,
  Server,
  Wifi,
  Wallet,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScamEntity {
  normalized_value: string;
  entity_type: string;
  risk_score: number;
  risk_level: string;
  report_count: number;
  last_seen: string;
  first_seen?: string;
  scam_types?: string[];
}

interface FraudManagerClientProps {
  initialHighRisk: ScamEntity[];
  alertCount: number;
  orgName: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const RISK_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  CRITICAL: {
    bg: "bg-red-100",
    text: "text-red-700",
    dot: "bg-red-500",
  },
  HIGH: {
    bg: "bg-orange-100",
    text: "text-orange-700",
    dot: "bg-orange-500",
  },
  MEDIUM: {
    bg: "bg-amber-100",
    text: "text-amber-700",
    dot: "bg-amber-500",
  },
  LOW: {
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    dot: "bg-emerald-500",
  },
};

const ENTITY_ICONS: Record<string, typeof Globe> = {
  url: Globe,
  domain: Globe,
  phone: Phone,
  email: Mail,
  ip: Wifi,
  crypto_wallet: Wallet,
  server: Server,
};

const ENTITY_BADGE_COLORS: Record<string, string> = {
  url: "bg-blue-100 text-blue-700",
  domain: "bg-indigo-100 text-indigo-700",
  phone: "bg-violet-100 text-violet-700",
  email: "bg-sky-100 text-sky-700",
  ip: "bg-slate-100 text-slate-600",
  crypto_wallet: "bg-amber-100 text-amber-700",
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function RiskPill({ level }: { level: string }) {
  const colors = RISK_COLORS[level] ?? RISK_COLORS.MEDIUM;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${colors.bg} ${colors.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
      {level}
    </span>
  );
}

function EntityBadge({ type }: { type: string }) {
  const Icon = ENTITY_ICONS[type] ?? Globe;
  const color = ENTITY_BADGE_COLORS[type] ?? "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${color}`}
    >
      <Icon size={10} />
      {type.replace("_", " ")}
    </span>
  );
}

function generateCSV(results: ScamEntity[]): void {
  const headers = [
    "Entity Type",
    "Value",
    "Report Count",
    "Risk Level",
    "Risk Score",
    "Last Seen",
  ];
  const rows = results.map((r) => [
    r.entity_type,
    `"${r.normalized_value.replace(/"/g, '""')}"`,
    String(r.report_count),
    r.risk_level,
    String(r.risk_score),
    r.last_seen,
  ]);
  const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `fraud-manager-export-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FraudManagerClient({
  initialHighRisk,
  alertCount,
  orgName,
}: FraudManagerClientProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ScamEntity[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  async function handleSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setHasSearched(true);
    setExpandedIdx(null);

    try {
      const supabase = createBrowserClient();
      const { data } = await supabase.rpc("fraud_manager_search", {
        p_query: trimmed,
        p_type: "auto",
      });
      setResults((data as ScamEntity[]) ?? []);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      handleSearch();
    }
  }

  const displayResults = hasSearched ? results : null;
  const showInitialFeed = !hasSearched && initialHighRisk.length > 0;

  return (
    <div className="p-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-deep-navy">
            Fraud Manager
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Search and investigate scam entities across the threat database
            {orgName ? ` for ${orgName}` : ""}
          </p>
        </div>

        {alertCount > 0 && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <span className="text-xs font-medium text-red-700">
              {alertCount.toLocaleString("en-AU")} alerts in 24h
            </span>
          </div>
        )}
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search by URL, phone, email, domain, IP, or crypto wallet..."
            className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-border-light bg-white text-sm text-deep-navy placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-action-teal/30 focus:border-action-teal transition"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-5 py-2.5 rounded-lg bg-action-teal text-white text-sm font-medium hover:bg-action-teal/90 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          Search
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader2 size={16} className="animate-spin" />
          Searching...
        </div>
      )}

      {/* Search results */}
      {!loading && displayResults !== null && (
        <>
          {displayResults.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <ShieldCheck size={48} className="text-emerald-400 mb-3" />
              <h2 className="text-base font-semibold text-deep-navy mb-1">
                No matches found
              </h2>
              <p className="text-sm text-slate-500 max-w-sm">
                No scam entities match your search. This could mean the entity
                is clean or hasn&apos;t been reported yet.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-500">
                  {displayResults.length} result
                  {displayResults.length !== 1 ? "s" : ""} found
                </p>
                <button
                  onClick={() => generateCSV(displayResults)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border-light text-xs font-medium text-gov-slate hover:bg-slate-50 transition"
                >
                  <Download size={12} />
                  Export CSV
                </button>
              </div>

              <ResultsTable
                results={displayResults}
                expandedIdx={expandedIdx}
                onToggle={(idx) =>
                  setExpandedIdx(expandedIdx === idx ? null : idx)
                }
              />
            </>
          )}
        </>
      )}

      {/* Initial feed */}
      {!loading && showInitialFeed && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={14} className="text-amber-500" />
            <h2 className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Recent Critical Threats
            </h2>
          </div>
          <ResultsTable
            results={initialHighRisk}
            expandedIdx={expandedIdx}
            onToggle={(idx) =>
              setExpandedIdx(expandedIdx === idx ? null : idx)
            }
          />
        </div>
      )}

      {/* Empty initial state (no threats either) */}
      {!loading && !hasSearched && initialHighRisk.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldAlert size={48} className="text-slate-300 mb-3" />
          <h2 className="text-base font-semibold text-deep-navy mb-1">
            Search the threat database
          </h2>
          <p className="text-sm text-slate-500 max-w-sm">
            Enter a URL, phone number, email, domain, IP address, or crypto
            wallet above to check against known scam entities.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results Table
// ---------------------------------------------------------------------------

function ResultsTable({
  results,
  expandedIdx,
  onToggle,
}: {
  results: ScamEntity[];
  expandedIdx: number | null;
  onToggle: (idx: number) => void;
}) {
  return (
    <div className="bg-white border border-border-light rounded-xl shadow-sm overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[120px_1fr_80px_100px_80px_32px] gap-3 px-4 py-2.5 bg-slate-50 border-b border-border-light text-[10px] font-medium uppercase tracking-wider text-slate-500">
        <span>Type</span>
        <span>Value</span>
        <span className="text-right">Reports</span>
        <span>Risk Level</span>
        <span className="text-right">Score</span>
        <span />
      </div>

      {/* Rows */}
      {results.map((entity, idx) => {
        const isExpanded = expandedIdx === idx;
        return (
          <div key={`${entity.entity_type}-${entity.normalized_value}-${idx}`}>
            <button
              type="button"
              onClick={() => onToggle(idx)}
              className="w-full grid grid-cols-[120px_1fr_80px_100px_80px_32px] gap-3 px-4 py-3 items-center text-left hover:bg-slate-50/60 transition border-b border-border-light/60 last:border-b-0"
            >
              <span>
                <EntityBadge type={entity.entity_type} />
              </span>
              <span
                className="text-sm text-deep-navy truncate"
                style={{ fontFamily: "ui-monospace, monospace" }}
                title={entity.normalized_value}
              >
                {entity.normalized_value}
              </span>
              <span
                className="text-sm text-right text-gov-slate tabular-nums"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {entity.report_count}
              </span>
              <span>
                <RiskPill level={entity.risk_level} />
              </span>
              <span
                className="text-sm text-right text-gov-slate tabular-nums"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {entity.risk_score}
              </span>
              <span className="flex justify-center text-slate-400">
                {isExpanded ? (
                  <ChevronUp size={14} />
                ) : (
                  <ChevronDown size={14} />
                )}
              </span>
            </button>

            {/* Expanded details */}
            {isExpanded && (
              <div className="px-4 py-4 bg-slate-50/40 border-b border-border-light/60">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                      First Seen
                    </p>
                    <p className="text-xs text-deep-navy">
                      {entity.first_seen
                        ? formatDate(entity.first_seen)
                        : "N/A"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                      Last Seen
                    </p>
                    <p className="text-xs text-deep-navy">
                      {formatDate(entity.last_seen)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                      Risk Score
                    </p>
                    <p className="text-xs text-deep-navy">
                      {entity.risk_score} / 100
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1">
                      Total Reports
                    </p>
                    <p className="text-xs text-deep-navy">
                      {entity.report_count}
                    </p>
                  </div>
                </div>

                {entity.scam_types && entity.scam_types.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400 mb-1.5">
                      Scam Types
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {entity.scam_types.map((st) => (
                        <span
                          key={st}
                          className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-medium"
                        >
                          {st}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

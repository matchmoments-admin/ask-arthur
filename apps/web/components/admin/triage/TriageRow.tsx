"use client";

import { Clock, Copy, ExternalLink, Camera, RefreshCw } from "lucide-react";
import ScoreBadge from "./ScoreBadge";
import MethodChip from "./MethodChip";
import MetaCell from "./MetaCell";
import VerdictButton from "./VerdictButton";
import UtilButton from "./UtilButton";
import { verdictKindToStatus, type TriageStatus, type VerdictKind } from "./types";

export interface PendingAlertView {
  id: number;
  candidate_domain: string;
  candidate_url: string;
  inferred_target_domain: string;
  signals: Array<{
    type?: string;
    signal_type?: string;
    score?: number;
    evidence?: Record<string, string | number>;
  }>;
  first_seen_at: string;
  urlscan_classification?:
    | "parked_for_sale"
    | "unresolved"
    | "likely_phishing"
    | "neutral"
    | null;
  urlscan_scanned_at?: string | null;
  urlscan_screenshot_url?: string | null;
  urlscan_effective_url?: string | null;
}

const URLSCAN_TONE: Record<
  NonNullable<PendingAlertView["urlscan_classification"]>,
  { bg: string; fg: string; ring: string; label: string }
> = {
  parked_for_sale: { bg: "#FFF7E6", fg: "#B45309", ring: "#F3DE92", label: "parked" },
  unresolved: { bg: "#F1F3F7", fg: "#475569", ring: "#DDE2EA", label: "unresolved" },
  likely_phishing: {
    bg: "var(--color-tp-bg)",
    fg: "var(--color-tp-fg)",
    ring: "var(--color-tp-ring)",
    label: "likely phishing",
  },
  neutral: { bg: "#EEF2F8", fg: "#1B3257", ring: "#DDE2EA", label: "resolves" },
};

function isHttpsUrlscanUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname.endsWith("urlscan.io");
  } catch {
    return false;
  }
}

function deriveBrand(inferred: string): string {
  // hellostake.com → stake (drop hellostake prefix-heuristic), domain.com.au → domain
  // Best-effort — falls back to the apex without TLD.
  const noProto = inferred.replace(/^https?:\/\//, "");
  const apex = noProto.split(".")[0] ?? noProto;
  return apex;
}

function deriveLabel(candidate: string): string {
  const apex = candidate.split(".")[0] ?? candidate;
  return apex;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}, ${hh}:${min}`;
}

interface TriageRowProps {
  row: PendingAlertView;
  disabled: boolean;
  onTriage: (id: number, status: TriageStatus) => void;
  onScan: (id: number) => void;
  /** Compact mode collapses the metadata grid (used in dense lists). */
  compact?: boolean;
  /** True when this row is part of the current bulk-selection. */
  selected?: boolean;
  /** Toggle bulk-selection for this row. When omitted, the checkbox is hidden. */
  onToggleSelect?: () => void;
}

export default function TriageRow({
  row,
  disabled,
  onTriage,
  onScan,
  compact,
  selected,
  onToggleSelect,
}: TriageRowProps) {
  const signal = row.signals?.[0];
  const method = signal?.signal_type ?? signal?.type ?? "unknown";
  const score = typeof signal?.score === "number" ? signal.score : 0;
  const dist = signal?.evidence?.dist ?? signal?.evidence?.edit_distance ?? "—";
  const brand = deriveBrand(row.inferred_target_domain);
  const label = deriveLabel(row.candidate_domain);
  const hasUrlscan = Boolean(row.urlscan_classification);
  const urlscanTone = row.urlscan_classification
    ? URLSCAN_TONE[row.urlscan_classification]
    : null;
  const sandboxUrl = `https://urlscan.io/search/#domain%3A${encodeURIComponent(row.candidate_domain)}`;

  const handleVerdict = (kind: VerdictKind) => {
    onTriage(row.id, verdictKindToStatus(kind));
  };

  return (
    <article
      className="flex flex-col"
      style={{
        background: selected ? "var(--color-teal-soft)" : "var(--color-surface)",
        borderBottom: "1px solid var(--color-line-soft)",
        padding: compact ? "12px 14px" : "14px 14px 16px",
        gap: compact ? 8 : 10,
      }}
    >
      {/* Header: checkbox (optional) + domain + score */}
      <header className="flex items-center gap-2">
        {onToggleSelect && (
          <label
            className="flex items-center shrink-0 cursor-pointer"
            style={{ padding: 2, marginRight: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={onToggleSelect}
              disabled={disabled}
              aria-label={`Select ${row.candidate_domain} for bulk action`}
              style={{
                width: 18,
                height: 18,
                accentColor: "var(--color-teal)",
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            />
          </label>
        )}
        <h3
          className="mono m-0 flex-1 min-w-0"
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: "var(--color-ink)",
            letterSpacing: "-0.005em",
            overflowWrap: "anywhere",
          }}
        >
          {row.candidate_domain}
        </h3>
        <ScoreBadge value={score} />
      </header>

      {/* Method + match summary + urlscan classification chip */}
      <div className="flex items-center gap-2 flex-wrap">
        <MethodChip method={method} />
        <span className="text-[12.5px]" style={{ color: "var(--color-muted)" }}>
          matches{" "}
          <span
            className="mono"
            style={{ color: "var(--color-ink-2)", fontWeight: 500 }}
          >
            {row.inferred_target_domain}
          </span>
        </span>
        {urlscanTone && (
          <span
            className="uppercase"
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 10.5,
              letterSpacing: "0.06em",
              fontWeight: 600,
              color: urlscanTone.fg,
              background: urlscanTone.bg,
              border: `1px solid ${urlscanTone.ring}`,
            }}
            title={
              row.urlscan_effective_url
                ? `urlscan effective URL: ${row.urlscan_effective_url}`
                : undefined
            }
          >
            {urlscanTone.label}
          </span>
        )}
      </div>

      {/* Urlscan screenshot thumbnail (when available) */}
      {isHttpsUrlscanUrl(row.urlscan_screenshot_url) && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.urlscan_screenshot_url!}
          alt={`Sandbox screenshot of ${row.candidate_domain}`}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="shrink-0"
          style={{
            width: "100%",
            maxWidth: 220,
            height: 88,
            objectFit: "cover",
            objectPosition: "top",
            border: "1px solid var(--color-line)",
            borderRadius: 8,
          }}
        />
      )}

      {/* Metadata grid */}
      {!compact && (
        <div
          className="grid grid-cols-3 gap-2"
          style={{
            padding: "10px 12px",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-line-soft)",
            borderRadius: 10,
          }}
        >
          <MetaCell label="Brand" value={brand} />
          <MetaCell label="Label" value={label} />
          <MetaCell label="Edit dist" value={String(dist)} mono />
        </div>
      )}

      {/* Timestamps */}
      <div
        className="flex items-center gap-3 flex-wrap"
        style={{
          fontSize: 11.5,
          color: "var(--color-muted)",
        }}
      >
        <span className="inline-flex items-center gap-1.5">
          <Clock size={12} />
          first seen{" "}
          <span className="mono" style={{ color: "var(--color-ink-2)" }}>
            {formatDate(row.first_seen_at)}
          </span>
        </span>
        {row.urlscan_scanned_at && (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "var(--color-muted-2)",
                display: "inline-block",
              }}
            />
            urlscan{" "}
            <span className="mono" style={{ color: "var(--color-ink-2)" }}>
              {formatDate(row.urlscan_scanned_at)}
            </span>
          </span>
        )}
      </div>

      {/* Utility buttons */}
      <div className="flex gap-1.5">
        <UtilButton
          icon={Copy}
          label="Copy"
          onClick={() => {
            void navigator.clipboard?.writeText(row.candidate_url);
          }}
          title="Copy candidate URL"
        />
        <UtilButton
          icon={ExternalLink}
          label="urlscan"
          href={sandboxUrl}
          title="urlscan.io public search (safe to open)"
        />
        <UtilButton
          icon={hasUrlscan ? RefreshCw : Camera}
          label={hasUrlscan ? "Re-scan" : "Scan"}
          onClick={() => onScan(row.id)}
          title={
            hasUrlscan
              ? "Re-scan via urlscan.io (~90s)"
              : "Scan via urlscan.io (~90s)"
          }
          disabled={disabled}
        />
      </div>

      {/* Verdict buttons */}
      <div className="flex gap-1.5">
        <VerdictButton
          kind="tp"
          onClick={() => handleVerdict("tp")}
          disabled={disabled}
          fullLabel="Confirm clone"
        />
        <VerdictButton
          kind="inv"
          onClick={() => handleVerdict("inv")}
          disabled={disabled}
        />
        <VerdictButton
          kind="fp"
          onClick={() => handleVerdict("fp")}
          disabled={disabled}
          fullLabel="Not a clone"
        />
      </div>
    </article>
  );
}

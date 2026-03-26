import type { ThreatEntity } from "@/lib/dashboard";

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const RISK_DOT: Record<string, string> = {
  CRITICAL: "bg-red-500",
  HIGH: "bg-red-400",
  MEDIUM: "bg-amber-400",
  LOW: "bg-slate-300",
  UNKNOWN: "bg-slate-200",
};

const TYPE_LABEL: Record<string, string> = {
  phone: "PHONE",
  email: "EMAIL",
  url: "URL",
  domain: "DOMAIN",
  ip: "IP",
  crypto_wallet: "CRYPTO",
  bank_account: "BANK",
};

export default function ThreatFeed({ entities }: { entities: ThreatEntity[] }) {
  return (
    <div className="rounded-lg border border-slate-200/60 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
        <h3 className="text-sm font-semibold text-deep-navy">Threat Entities</h3>
        {entities.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Live
            </span>
          </div>
        )}
      </div>

      {entities.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-slate-400">
          No threat entities detected yet. Data populates as users submit scam reports.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100/80">
          {entities.map((entity) => (
            <li
              key={entity.id}
              className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/50 transition-colors"
            >
              {/* Severity dot */}
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${RISK_DOT[entity.risk_level || "UNKNOWN"]}`}
              />

              {/* Type badge */}
              <span
                className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-slate-500"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {TYPE_LABEL[entity.entity_type] || entity.entity_type}
              </span>

              {/* Value */}
              <span
                className="min-w-0 flex-1 truncate text-sm text-deep-navy"
                style={{ fontFamily: "ui-monospace, monospace" }}
              >
                {entity.normalized_value}
              </span>

              {/* Report count */}
              <span
                className="shrink-0 text-xs text-slate-400"
                style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
              >
                {entity.report_count} report{entity.report_count !== 1 ? "s" : ""}
              </span>

              {/* Time */}
              <span
                className="shrink-0 text-[10px] text-slate-400"
                style={{ fontVariantNumeric: "tabular-nums", fontFamily: "ui-monospace, monospace" }}
              >
                {relativeTime(entity.last_seen)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

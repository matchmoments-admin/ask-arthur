import {
  COMPONENT_LABELS,
  READINESS_REQUIRED_MONTHS,
  type ComponentResult,
  type ComponentStatus,
  type ReadinessGate,
  type Scorecard,
} from "@/lib/clone-watch/readiness";

/**
 * The readiness scorecard (#1237) on /admin/clone-watch: the gate every real
 * brand send checks, the last three stored months, and why each component
 * passes, fails or has insufficient data. "Insufficient data" is deliberately
 * NOT rendered as a failure — it asks for measurement, not a fix — but it
 * still keeps the month not ready.
 */

const RATIO_KEYS = new Set(["precision", "fp_share", "fn_rate", "stock"]);

function fmtValue(c: ComponentResult): string {
  if (c.value === null) return "not measured";
  if (RATIO_KEYS.has(c.key)) return `${(c.value * 100).toFixed(1)}%`;
  if (c.key === "lane_health") return `${c.value} day${c.value === 1 ? "" : "s"}`;
  return String(c.value);
}

function fmtThreshold(c: ComponentResult): string {
  if (c.key === "precision") return `≥ ${(c.threshold * 100).toFixed(0)}%`;
  if (RATIO_KEYS.has(c.key)) return `≤ ${(c.threshold * 100).toFixed(0)}%`;
  if (c.key === "lane_health") return `≤ ${c.threshold} days`;
  return `≤ ${c.threshold}`;
}

const STATUS_STYLE: Record<ComponentStatus, { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-emerald-50 text-emerald-800 border-emerald-300" },
  fail: { label: "Fail", cls: "bg-red-50 text-red-800 border-red-300" },
  insufficient: {
    label: "Insufficient data",
    cls: "bg-amber-50 text-amber-800 border-amber-300",
  },
};

function StatusBadge({ status }: { status: ComponentStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  );
}

function monthLabel(periodMonth: string): string {
  return new Date(`${periodMonth}T00:00:00Z`).toLocaleDateString("en-AU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function ReadinessPanel({
  cards,
  gate,
}: {
  /** Newest first; null = the table could not be read. */
  cards: Array<Scorecard & { computedAt: string | null }> | null;
  gate: ReadinessGate;
}) {
  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-deep-navy">
          Readiness scorecard — may we contact brands?
        </h2>
        <span
          className={`rounded border px-2 py-0.5 text-xs font-semibold ${
            gate.ready
              ? "border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border-slate-300 bg-slate-50 text-slate-700"
          }`}
        >
          {gate.ready
            ? `Gate OPEN — ${gate.months.map(monthLabel).join(" and ")} ready`
            : `Gate CLOSED — real brand sends stay in shadow`}
        </span>
      </div>
      <p className="mb-3 text-xs text-gov-slate">
        A real brand send (stewardship report, brand-notify batch) needs{" "}
        {READINESS_REQUIRED_MONTHS} consecutive closed months reading ready (
        {gate.months.map(monthLabel).join(", ")}), on top of its own flag and the
        #371 legal sign-off.
        {!gate.ready && (
          <>
            {" "}
            Now: <code>{gate.reason}</code>.
          </>
        )}{" "}
        Computed on the 1st at 11:00 UTC by clone-watch-report-summary; recompute a
        month with its manual trigger <code>{`{ periodMonth: "YYYY-MM" }`}</code>.
      </p>

      {cards === null ? (
        <p className="text-xs text-red-700">
          The scorecard could not be read — that reads as NOT ready.
        </p>
      ) : cards.length === 0 ? (
        <p className="text-xs text-gov-slate">
          No month has been scored yet — the next scheduled run is the 1st of the month, or use the manual trigger above.
        </p>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <div key={card.periodMonth}>
              <h3 className="mb-1 text-xs font-semibold text-deep-navy">
                {monthLabel(card.periodMonth)} —{" "}
                {card.ready ? "ready" : "not ready"}
                {card.computedAt && (
                  <span className="font-normal text-gov-slate">
                    {" "}
                    (computed {card.computedAt.slice(0, 16).replace("T", " ")} UTC)
                  </span>
                )}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gov-slate">
                      <th className="py-1 pr-2 font-medium">Component</th>
                      <th className="py-1 pr-2 font-medium">Status</th>
                      <th className="py-1 pr-2 font-medium">Value</th>
                      <th className="py-1 pr-2 font-medium">n</th>
                      <th className="py-1 pr-2 font-medium">Threshold</th>
                      <th className="py-1 font-medium">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {card.components.map((c) => (
                      <tr key={c.key} className="border-t border-slate-100 align-top">
                        <td className="py-1 pr-2">{COMPONENT_LABELS[c.key]}</td>
                        <td className="py-1 pr-2">
                          <StatusBadge status={c.status} />
                        </td>
                        <td className="py-1 pr-2 tabular-nums">{fmtValue(c)}</td>
                        <td className="py-1 pr-2 tabular-nums">{c.n ?? "—"}</td>
                        <td className="py-1 pr-2 whitespace-nowrap">{fmtThreshold(c)}</td>
                        <td className="py-1 text-gov-slate">{c.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

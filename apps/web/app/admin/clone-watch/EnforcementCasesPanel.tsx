/**
 * Read-only enforcement case list (Wave 1 PR 1.6).
 *
 * Renders the open multi-channel takedown cases (shopfront_takedown_attempts,
 * v201) opened by clone-watch-enforcement-plan when a lookalike weaponises. This
 * is the audit-ready, sellable record — and the itch.io-invariant checkpoint: a
 * human sees every case here BEFORE any outbound send is enabled. Actions
 * (approve / send / mark actioned) land in a later PR; this is visibility only.
 *
 * Presentational — no client interactivity yet, so it stays a server component.
 */

export interface EnforcementCase {
  case_id: number;
  clone_alert_id: number;
  candidate_domain: string;
  candidate_url: string;
  target_brand_normalized: string | null;
  lifecycle_state: string;
  channel: string;
  channel_autonomy: string;
  case_status: string;
  acts_on_parked: boolean;
  external_ref: string | null;
  evidence_bundle: Record<string, unknown> | null;
  next_action_at: string | null;
  submitted_at: string | null;
  updated_at: string;
  created_at: string;
}

const AUTONOMY_LABEL: Record<string, string> = {
  auto: "auto",
  human_required: "human",
  brand_routed: "brand",
};

function badge(bg: string, color: string, text: string) {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ background: bg, color }}
    >
      {text}
    </span>
  );
}

function autonomyBadge(a: string) {
  // human/brand levers are the ones carrying takedown liability — flag them.
  if (a === "auto") return badge("#e6f4ea", "#137333", "auto");
  if (a === "brand_routed") return badge("#e8f0fe", "#1a56db", "brand");
  return badge("#fef7e0", "#b06000", "human");
}

function statusBadge(s: string) {
  const map: Record<string, [string, string]> = {
    queued: ["#f1f3f4", "#5f6368"],
    drafted: ["#f1f3f4", "#5f6368"],
    pending_approval: ["#fef7e0", "#b06000"],
    submitted: ["#e8f0fe", "#1a56db"],
    acknowledged: ["#e8f0fe", "#1a56db"],
    actioned: ["#e6f4ea", "#137333"],
    re_emerged: ["#fce8e6", "#c5221f"],
  };
  const [bg, color] = map[s] ?? ["#f1f3f4", "#5f6368"];
  return badge(bg, color, s.replace(/_/g, " "));
}

export default function EnforcementCasesPanel({
  cases,
}: {
  cases: EnforcementCase[];
}) {
  return (
    <section className="mt-8">
      <h2 className="text-deep-navy mb-1 text-sm font-semibold">
        Enforcement cases{" "}
        <span className="text-gov-slate font-normal">({cases.length} open)</span>
      </h2>
      <p className="text-gov-slate mb-3 text-[12px]">
        Multi-channel takedown cases opened when a lookalike weaponised. Human /
        brand levers carry takedown liability — review each before actioning
        (sends are not yet wired; this is the audit record).
      </p>
      {cases.length === 0 ? (
        <p className="text-gov-slate text-[13px]">
          No open enforcement cases. Cases open automatically when a monitored
          lookalike is scanned as likely-phishing and{" "}
          <code>FF_CLONE_ENFORCEMENT</code> is on.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-gov-slate text-left">
                <th className="py-1 pr-3 font-semibold">Domain</th>
                <th className="py-1 pr-3 font-semibold">Brand</th>
                <th className="py-1 pr-3 font-semibold">Channel</th>
                <th className="py-1 pr-3 font-semibold">Autonomy</th>
                <th className="py-1 pr-3 font-semibold">Status</th>
                <th className="py-1 pr-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => {
                const deepLink =
                  typeof c.evidence_bundle?.deep_link === "string"
                    ? (c.evidence_bundle.deep_link as string)
                    : null;
                return (
                  <tr
                    key={c.case_id}
                    className="border-t"
                    style={{ borderColor: "var(--color-line)" }}
                  >
                    <td className="py-1.5 pr-3">
                      <span className="font-mono">{c.candidate_domain}</span>
                    </td>
                    <td className="py-1.5 pr-3">
                      {c.target_brand_normalized ?? "—"}
                    </td>
                    <td className="py-1.5 pr-3">{c.channel}</td>
                    <td className="py-1.5 pr-3">
                      {autonomyBadge(c.channel_autonomy)}
                    </td>
                    <td className="py-1.5 pr-3">{statusBadge(c.case_status)}</td>
                    <td className="py-1.5 pr-3">
                      {deepLink ? (
                        <a
                          href={deepLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: "var(--color-link)" }}
                        >
                          Report ↗
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

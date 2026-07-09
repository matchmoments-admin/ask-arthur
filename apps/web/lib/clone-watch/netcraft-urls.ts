import { domainToASCII } from "node:url";

/**
 * Netcraft Report API v3 — per-URL reader + false-negative predicate.
 *
 * Why per-URL: a bulk submission carries ≤50 URLs under ONE uuid, and the
 * submission-level `state` is a rollup that reads "malicious" if ANY url is
 * malicious. The branded lookalikes we care about frequently sit at
 * `no threats` / `unavailable` INSIDE that malicious batch — invisible unless
 * you read the per-URL `url_state` from GET /submission/{uuid}/urls.
 *
 * The API is keyless (email-identified submissions; the uuid is the capability)
 * — GET /submission/{uuid} and /urls return 200 with no Authorization header.
 */

const NETCRAFT_API_BASE = "https://report.netcraft.com/api/v3";
// Tightened from 12s (FIX-10): under Netcraft degradation we want to bail early
// so the whole run stays under the 5m finish budget / 10m watchdog.
const DEFAULT_TIMEOUT_MS = 8_000;
// Our bulk batches are ≤50 URLs; /urls paginates at 25 by default, so we must
// ask for more or we silently drop candidates ≥26. 500 covers any real batch in
// one call (Netcraft returned all 38 of acDb with ?count=100).
const URLS_PAGE_COUNT = 500;

/** Netcraft per-URL states (normalised: lowercased, single-spaced). */
export const NETCRAFT_URL_STATE = {
  MALICIOUS: "malicious",
  NO_THREATS: "no threats",
  UNAVAILABLE: "unavailable",
  SUSPICIOUS: "suspicious",
  PROCESSING: "processing",
  REJECTED: "rejected",
} as const;

// Actioned — a matched alert whose host is malicious is done (taken down).
const ACTIONED = new Set<string>([NETCRAFT_URL_STATE.MALICIOUS]);
// Unsettled — still moving; wait and re-check rather than file or drop.
const UNSETTLED = new Set<string>([
  NETCRAFT_URL_STATE.SUSPICIOUS,
  NETCRAFT_URL_STATE.PROCESSING,
]);
// Every state we recognise — anything outside this set is drift we log.
const KNOWN_STATES = new Set<string>(Object.values(NETCRAFT_URL_STATE));

export interface NetcraftUrlEntry {
  url: string;
  hostname: string;
  url_state: string;
  uuid?: string;
}

export interface NetcraftSubmissionUrls {
  ok: boolean;
  status: number;
  /** Authoritative archival flag — the /report_issue endpoint 404s once archived. */
  isArchived: boolean;
  /** Submission already has an issue filed. */
  hasIssues: boolean;
  urls: NetcraftUrlEntry[];
  /** total_count from the /urls envelope, for pagination-gap detection. */
  totalCount: number;
  /** Per-state histogram from the submission object (state_counts.urls). */
  stateCounts: Record<string, number>;
  /**
   * True when the submission object showed zero escalatable states, so the
   * /urls GET was skipped entirely (efficiency) — every alert on this uuid is
   * actioned/unsettled and should be drained, not filed.
   */
  noEscalatable: boolean;
}

/**
 * Normalise a hostname or URL to a comparable ASCII (punycode) host.
 * Resolves the IDN-homograph class: our candidate_domain is ASCII punycode from
 * whoisds, but Netcraft may return decoded Unicode. Also strips scheme, port
 * (URL.hostname already drops it), leading `www.`, trailing dot, and lowercases.
 */
export function normHost(input: string): string {
  if (!input) return "";
  let host = input.trim();
  try {
    host = new URL(host.includes("://") ? host : `https://${host}`).hostname;
  } catch {
    // not a URL — treat the raw input as a host
  }
  host = host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  return domainToASCII(host) || host;
}

function normState(state: string): string {
  return (state ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

export interface FalseNegativeCandidate {
  alertId: number;
  candidateUrl: string;
  candidateDomain: string;
  brand: string;
  urlState: string;
}

export interface PendingAlert {
  id: number;
  candidate_url: string;
  candidate_domain: string;
  inferred_target_domain: string | null;
  target_brand_normalized: string | null;
}

/** A matched alert that must be drained (never re-fetched) with a reason. */
export interface TerminalAlert {
  alert: PendingAlert;
  reason: "actioned" | "unavailable_deferred" | "no_escalatable_state";
}

export interface SelectResult {
  /** Branded false negatives to escalate. */
  candidates: FalseNegativeCandidate[];
  /** Matched but done — stamp terminal so they drain. */
  terminal: TerminalAlert[];
  /** Matched but still moving (suspicious/processing) — recheck later. */
  transient: PendingAlert[];
  /** Host never appeared in /urls (may be incomplete ingest — guard the drain). */
  notInUrls: PendingAlert[];
  /** url_state values seen outside KNOWN_STATES — logged as drift. */
  driftStates: string[];
}

/**
 * Pure predicate: given our alerts for one submission + that submission's
 * per-URL entries, classify each alert into exactly one bucket.
 *
 * Escalatable = { "no threats" } at go-live; also "unavailable" in dry-run
 * (allowUnavailable). Classification per matched host's state set S:
 *   - malicious in S           → terminal 'actioned'
 *   - suspicious/processing S   → transient (recheck; don't file or drop)
 *   - escalatable in S (no above) → candidate
 *   - unavailable only, not allowed → terminal 'unavailable_deferred' (PR3)
 *   - only unknown/rejected     → terminal 'no_escalatable_state' (+ drift)
 */
export function selectFalseNegativeCandidates(
  alerts: PendingAlert[],
  urls: NetcraftUrlEntry[],
  opts: { allowUnavailable: boolean },
): SelectResult {
  const escalatable = new Set<string>([NETCRAFT_URL_STATE.NO_THREATS]);
  if (opts.allowUnavailable) escalatable.add(NETCRAFT_URL_STATE.UNAVAILABLE);

  const byHost = new Map<string, string[]>();
  const driftStates = new Set<string>();
  for (const entry of urls) {
    const host = normHost(entry.hostname || entry.url);
    if (!host) continue;
    const s = normState(entry.url_state);
    (byHost.get(host) ?? byHost.set(host, []).get(host)!).push(s);
    if (s && !KNOWN_STATES.has(s)) driftStates.add(s);
  }

  const candidates: FalseNegativeCandidate[] = [];
  const terminal: TerminalAlert[] = [];
  const transient: PendingAlert[] = [];
  const notInUrls: PendingAlert[] = [];

  for (const alert of alerts) {
    const host = normHost(alert.candidate_domain || alert.candidate_url);
    const states = byHost.get(host);
    if (!states || states.length === 0) {
      notInUrls.push(alert);
      continue;
    }
    const S = new Set(states);
    if ([...S].some((s) => ACTIONED.has(s))) {
      terminal.push({ alert, reason: "actioned" });
      continue;
    }
    if ([...S].some((s) => UNSETTLED.has(s))) {
      transient.push(alert);
      continue;
    }
    const hit =
      (S.has(NETCRAFT_URL_STATE.NO_THREATS) && NETCRAFT_URL_STATE.NO_THREATS) ||
      [...S].find((s) => escalatable.has(s));
    if (hit) {
      candidates.push({
        alertId: alert.id,
        candidateUrl: alert.candidate_url,
        candidateDomain: alert.candidate_domain,
        brand:
          alert.target_brand_normalized ||
          alert.inferred_target_domain ||
          "an Australian brand",
        urlState: hit,
      });
      continue;
    }
    // No escalatable state and not allowed: unavailable → defer to PR3, else no-op.
    terminal.push({
      alert,
      reason: S.has(NETCRAFT_URL_STATE.UNAVAILABLE)
        ? "unavailable_deferred"
        : "no_escalatable_state",
    });
  }

  return { candidates, terminal, transient, notInUrls, driftStates: [...driftStates] };
}

export interface ReconcileAlert {
  id: number;
  candidate_domain: string;
}

export interface ReconcileClassification {
  /** Netcraft actioned (malicious) → lifecycle taken_down (+ stamp takedown_at). */
  takenDown: number[];
  /** Netcraft declined (no threats / unavailable) → lifecycle declined. */
  declined: number[];
  /** Still moving / no match / unknown → leave lifecycle, just mark reconciled. */
  other: number[];
}

/**
 * Map each submitted alert to a lifecycle bucket by its OWN per-URL state
 * (never the submission rollup). Precedence per matched host: malicious wins
 * (taken_down); else any suspicious/processing → still moving (other); else
 * no-threats/unavailable → declined; else other. Unmatched hosts → other.
 */
export function classifyByUrlState(
  alerts: ReconcileAlert[],
  urls: NetcraftUrlEntry[],
): ReconcileClassification {
  const byHost = new Map<string, Set<string>>();
  for (const entry of urls) {
    const host = normHost(entry.hostname || entry.url);
    if (!host) continue;
    (byHost.get(host) ?? byHost.set(host, new Set()).get(host)!).add(
      normState(entry.url_state),
    );
  }
  const takenDown: number[] = [];
  const declined: number[] = [];
  const other: number[] = [];
  for (const alert of alerts) {
    const S = byHost.get(normHost(alert.candidate_domain));
    if (!S || S.size === 0) {
      other.push(alert.id);
      continue;
    }
    if (S.has(NETCRAFT_URL_STATE.MALICIOUS)) takenDown.push(alert.id);
    else if (S.has(NETCRAFT_URL_STATE.SUSPICIOUS) || S.has(NETCRAFT_URL_STATE.PROCESSING))
      other.push(alert.id);
    else if (
      S.has(NETCRAFT_URL_STATE.NO_THREATS) ||
      S.has(NETCRAFT_URL_STATE.UNAVAILABLE)
    )
      declined.push(alert.id);
    else other.push(alert.id);
  }
  return { takenDown, declined, other };
}

/**
 * Keyless fetch of a submission's per-URL truth. Reads the submission object
 * first (is_archived / has_issues / state_counts). If `opts.escalatableStates`
 * is given and the state_counts histogram shows none of them, the /urls GET is
 * SKIPPED (noEscalatable=true) — the whole batch is actioned/unsettled.
 *
 * Throws on network/transport error (Inngest retries). A non-200 on either GET
 * is returned structured (ok:false); a 404 on the submission means archived.
 */
export async function fetchNetcraftSubmissionUrls(
  uuid: string,
  opts?: { escalatableStates?: string[]; timeoutMs?: number },
): Promise<NetcraftSubmissionUrls> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const encoded = encodeURIComponent(uuid);

  const subRes = await fetch(`${NETCRAFT_API_BASE}/submission/${encoded}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!subRes.ok) {
    return {
      ok: false,
      status: subRes.status,
      isArchived: subRes.status === 404,
      hasIssues: false,
      urls: [],
      totalCount: 0,
      stateCounts: {},
      noEscalatable: false,
    };
  }
  const sub = (await subRes.json()) as Record<string, unknown>;
  const isArchived = sub.is_archived === 1 || sub.is_archived === true;
  const hasIssues = sub.has_issues === 1 || sub.has_issues === true;
  const stateCounts =
    ((sub.state_counts as { urls?: Record<string, number> } | undefined)?.urls) ??
    {};

  // Pre-filter: skip the /urls GET when the histogram has no escalatable state.
  if (opts?.escalatableStates && Object.keys(stateCounts).length > 0) {
    const anyEscalatable = opts.escalatableStates.some(
      (s) => (stateCounts[s] ?? 0) > 0,
    );
    if (!anyEscalatable) {
      return {
        ok: true,
        status: 200,
        isArchived,
        hasIssues,
        urls: [],
        totalCount: 0,
        stateCounts,
        noEscalatable: true,
      };
    }
  }

  const urlsRes = await fetch(
    `${NETCRAFT_API_BASE}/submission/${encoded}/urls?count=${URLS_PAGE_COUNT}`,
    { signal: AbortSignal.timeout(timeoutMs) },
  );
  if (!urlsRes.ok) {
    return {
      ok: false,
      status: urlsRes.status,
      isArchived,
      hasIssues,
      urls: [],
      totalCount: 0,
      stateCounts,
      noEscalatable: false,
    };
  }
  const body = (await urlsRes.json()) as {
    total_count?: number;
    urls?: NetcraftUrlEntry[];
  };
  const urls = Array.isArray(body.urls) ? body.urls : [];
  return {
    ok: true,
    status: 200,
    isArchived,
    hasIssues,
    urls,
    totalCount: typeof body.total_count === "number" ? body.total_count : urls.length,
    stateCounts,
    noEscalatable: false,
  };
}

export { NETCRAFT_API_BASE, DEFAULT_TIMEOUT_MS };

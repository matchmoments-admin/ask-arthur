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
const DEFAULT_TIMEOUT_MS = 12_000;
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

// States that mean "actioned or not yet settled" — never escalate these.
const NOT_ESCALATABLE = new Set<string>([
  NETCRAFT_URL_STATE.MALICIOUS,
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
  /** Submission already has an issue filed (advisory — per-alert stamp governs). */
  hasIssues: boolean;
  urls: NetcraftUrlEntry[];
  /** total_count from the /urls envelope, for pagination-gap detection. */
  totalCount: number;
}

/**
 * Normalise a hostname or URL to a comparable ASCII (punycode) host.
 * Resolves the IDN-homograph class (e.g. `inistagram.ir`): our candidate_domain
 * is ASCII punycode from whoisds, but Netcraft may return decoded Unicode.
 * Also strips scheme, port (URL.hostname already drops it), leading `www.`,
 * trailing dot, and lowercases.
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
  netcraft_uuid: string;
}

export interface SelectResult {
  candidates: FalseNegativeCandidate[];
  /** Alerts whose host never appeared in /urls — stamped 'not_in_urls' to drain. */
  notInUrls: PendingAlert[];
  /** url_state values seen that are outside KNOWN_STATES — logged as drift. */
  driftStates: string[];
}

/**
 * Pure predicate: given our grouped alerts for one submission and that
 * submission's per-URL entries, pick the branded false negatives.
 *
 * An alert is a candidate iff its host matches ≥1 /urls entry, NONE of the
 * matched entries is actioned/unsettled (malicious/suspicious/processing), and
 * at least one matched entry is in the allowed set:
 *   - allowUnavailable=false (go-live): { "no threats" } only. Netcraft graded
 *     it clean after fetching → a genuine, disputable false negative.
 *   - allowUnavailable=true  (dry-run / PR3 w/ screenshots): also "unavailable"
 *     (parked/cloaked — Netcraft couldn't fetch).
 */
export function selectFalseNegativeCandidates(
  alerts: PendingAlert[],
  urls: NetcraftUrlEntry[],
  opts: { allowUnavailable: boolean },
): SelectResult {
  const allow = new Set<string>([NETCRAFT_URL_STATE.NO_THREATS]);
  if (opts.allowUnavailable) allow.add(NETCRAFT_URL_STATE.UNAVAILABLE);

  // host → list of entries (a host can appear on multiple URLs in a batch)
  const byHost = new Map<string, NetcraftUrlEntry[]>();
  const driftStates = new Set<string>();
  for (const entry of urls) {
    const host = normHost(entry.hostname || entry.url);
    if (!host) continue;
    const list = byHost.get(host) ?? [];
    list.push(entry);
    byHost.set(host, list);
    const s = normState(entry.url_state);
    if (s && !KNOWN_STATES.has(s)) driftStates.add(s);
  }

  const candidates: FalseNegativeCandidate[] = [];
  const notInUrls: PendingAlert[] = [];

  for (const alert of alerts) {
    const host = normHost(alert.candidate_domain || alert.candidate_url);
    const matched = byHost.get(host);
    if (!matched || matched.length === 0) {
      notInUrls.push(alert);
      continue;
    }
    const states = matched.map((m) => normState(m.url_state));
    // Any actioned/unsettled entry on this host → do not escalate.
    if (states.some((s) => NOT_ESCALATABLE.has(s))) continue;
    // Pick the first escalatable state (prefer "no threats" over "unavailable").
    const hit =
      states.find((s) => s === NETCRAFT_URL_STATE.NO_THREATS) ??
      states.find((s) => allow.has(s));
    if (!hit) continue;
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
  }

  return { candidates, notInUrls, driftStates: [...driftStates] };
}

/**
 * Keyless fetch of a submission's per-URL truth. Returns the submission-level
 * is_archived/has_issues plus the (paginated-complete) url list.
 *
 * Throws on network/transport error (Inngest retries). A non-200 on the
 * submission GET is returned structured (ok:false) — a 404 there means the
 * submission is gone/archived, which the caller treats as a permanent skip.
 */
export async function fetchNetcraftSubmissionUrls(
  uuid: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<NetcraftSubmissionUrls> {
  const encoded = encodeURIComponent(uuid);

  const subRes = await fetch(`${NETCRAFT_API_BASE}/submission/${encoded}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!subRes.ok) {
    // 404 → submission archived/removed. Any non-200 → skip this run.
    return {
      ok: false,
      status: subRes.status,
      isArchived: subRes.status === 404,
      hasIssues: false,
      urls: [],
      totalCount: 0,
    };
  }
  const sub = (await subRes.json()) as Record<string, unknown>;
  const isArchived = sub.is_archived === 1 || sub.is_archived === true;
  const hasIssues = sub.has_issues === 1 || sub.has_issues === true;

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
  };
}

export { NETCRAFT_API_BASE };

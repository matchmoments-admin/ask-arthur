/**
 * Attribution — the ONE reader of `shopfront_clone_alerts.attribution`.
 *
 * One writer (`enrichCloneAttribution` → `CloneAttribution`, enrich-attribution.ts)
 * and, until 2026-09-23, seven hand-written reader shapes. Two of them read a
 * flat `registrar_abuse_email` that nothing writes (0 rows vs 2,455 under
 * `whois.registrarAbuseEmail`), so the registrar-abuse takedown channel could
 * never be offered (matrix, fixed #1176) and — once it was — could never be
 * sent (admin send route, 422 `no_abuse_recipient`). A test pinned the fiction.
 *
 * Every reader goes through `readAttribution`. It is typed against the writer's
 * `CloneAttribution`, so a writer change breaks the reader at compile time, and
 * it is tolerant of anything jsonb can hold (null, strings, numbers-as-ASN,
 * the legacy flat keys) because it reads a column, not a TS value.
 *
 * Pure: no I/O. `abuseChannels()` is the takedown view of the same data — the
 * registrar/host levers a brand or operator can pull — using the curated abuse
 * pages in lib/email/registrar-abuse.ts with ICANN as the universal fallback.
 */
import type { CloneAttribution } from "@/lib/clone-watch/enrich-attribution";
import {
  ICANN_COMPLAINT_URL,
  hostAbuseUrl,
  registrarAbuseUrl,
} from "@/lib/email/registrar-abuse";

export interface AttributionView {
  registrar: string | null;
  registrarIanaId: string | null;
  registrarAbuseEmail: string | null;
  /** RDAP/WHOIS creation date (ISO date string). */
  createdDate: string | null;
  nameServers: string[];
  /** EPP status codes as stored, e.g. "client hold". */
  statuses: string[];
  /** Registrar country — infrastructure, not the operator's location. */
  registrantCountry: string | null;
  hosting: { ip: string | null; asn: string | null; country: string | null };
  /** AbuseIPDB score 0..100 for the hosting IP. */
  ipAbuseScore: number | null;
  auAbnStatus: string | null;
  auNameMatchesAbn: boolean | null;
  /** rdap | whoisjson | none — null when the alert was never enriched. */
  source: string | null;
  enrichedAt: string | null;
}

export const EMPTY_ATTRIBUTION: AttributionView = Object.freeze({
  registrar: null,
  registrarIanaId: null,
  registrarAbuseEmail: null,
  createdDate: null,
  nameServers: [],
  statuses: [],
  registrantCountry: null,
  hosting: { ip: null, asn: null, country: null },
  ipAbuseScore: null,
  auAbnStatus: null,
  auNameMatchesAbn: null,
  source: null,
  enrichedAt: null,
}) as AttributionView;

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
/** Non-empty trimmed string; numbers are stringified (ASNs arrive as both). */
const str = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};
/** A scalar that WHOIS sometimes returns as a list of records (prod 2026-06-15:
 *  registrar = ["GoDaddy.com, LLC", "Reseller"]) — the first non-empty entry. */
const firstStr = (v: unknown): string | null =>
  Array.isArray(v) ? (v.map(str).find((s) => s !== null) ?? null) : str(v);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : [];
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

/**
 * Normalise the stored jsonb. The `CloneAttribution` parameter type documents
 * what the writer produces; `unknown` is accepted because callers read a jsonb
 * column. Legacy flat keys (`registrar`, `registrar_abuse_email`) are a read
 * fallback only — nothing writes them.
 */
export function readAttribution(
  raw: CloneAttribution | Obj | null | undefined | unknown,
): AttributionView {
  if (!raw || typeof raw !== "object") return EMPTY_ATTRIBUTION;
  const a = obj(raw);
  const whois = obj(a.whois);
  const hosting = obj(a.hosting);
  const ipRep = obj(a.ip_rep);
  const au = obj(a.au_registrant);
  return {
    registrar: firstStr(whois.registrar) ?? firstStr(a.registrar),
    registrarIanaId: str(whois.registrarIanaId),
    registrarAbuseEmail:
      firstStr(whois.registrarAbuseEmail) ?? firstStr(a.registrar_abuse_email),
    createdDate: str(whois.createdDate),
    nameServers: strList(whois.nameServers),
    statuses: strList(whois.statuses),
    registrantCountry: str(whois.registrantCountry),
    hosting: {
      ip: str(hosting.ip),
      asn: str(hosting.asn),
      country: str(hosting.country),
    },
    ipAbuseScore: num(ipRep.abuseConfidenceScore),
    auAbnStatus: str(au.abnStatus),
    auNameMatchesAbn: bool(au.nameMatchesAbn),
    source: str(whois.source),
    enrichedAt: str(a.enriched_at),
  };
}

export interface AbuseChannel {
  kind: "registrar" | "hosting";
  /** Emailable intake, when WHOIS/RDAP gave one. */
  email: string | null;
  /** Self-serve abuse form; registrar channel always has one (ICANN fallback). */
  url: string | null;
  /** Registrar name or hosting ASN, for the operator/brand-facing note. */
  label: string;
}

/**
 * The takedown levers this attribution evidences. Registrar: offered when we
 * know WHO registered it (name or email) — email when RDAP gave one, the
 * curated abuse page when we know the registrar, else ICANN. Hosting: offered
 * only where a self-serve form exists for the ASN (today Cloudflare).
 */
export function abuseChannels(view: AttributionView): AbuseChannel[] {
  const out: AbuseChannel[] = [];
  if (view.registrar || view.registrarAbuseEmail) {
    out.push({
      kind: "registrar",
      email: view.registrarAbuseEmail,
      url: registrarAbuseUrl(view.registrar) ?? ICANN_COMPLAINT_URL,
      label: view.registrar ?? "unknown registrar",
    });
  }
  const hostUrl = hostAbuseUrl(view.hosting.asn);
  if (hostUrl) {
    out.push({
      kind: "hosting",
      email: null,
      url: hostUrl,
      label: view.hosting.asn ?? "unknown host",
    });
  }
  return out;
}

/** The attribution inputs of `computeWeaponisationRisk` (weaponisation-risk.ts),
 *  so every caller scores from the same read — recheck ranking and the
 *  stewardship ledger used to hand-destructure them separately. */
export function attributionRiskInputs(raw: unknown): {
  whoisCreatedDate: string | null;
  ipAbuseConfidenceScore: number | null;
  auAbnStatus: string | null;
  auNameMatches: boolean | null;
} {
  const v = readAttribution(raw);
  return {
    whoisCreatedDate: v.createdDate,
    ipAbuseConfidenceScore: v.ipAbuseScore,
    auAbnStatus: v.auAbnStatus,
    auNameMatches: v.auNameMatchesAbn,
  };
}

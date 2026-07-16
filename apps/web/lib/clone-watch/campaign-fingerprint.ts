import { createHash } from "node:crypto";
import { canonicalRegistrar } from "./registrar-canonical";

/**
 * Deterministic "campaign key" — a coarse actor fingerprint over the
 * infrastructure attributes we already persist per clone alert. Two lookalikes
 * that share a registrar + nameserver operator + hosting ASN + cert issuer are
 * very likely the SAME operator's campaign ("one actor, N domains targeting
 * your brand"), which is the cross-alert story brands / SPF buyers care about.
 *
 * $0 — pure over existing attribution data, no external calls. Computed in TS
 * (never SQL) so it reuses canonicalRegistrar() — the one registrar-folding
 * home — instead of forking that logic into PL/pgSQL.
 *
 * Returns null when fewer than 2 components are present: an all-null
 * fingerprint would cluster every unattributable domain together, which is
 * worse than no cluster. Callers persist the sentinel "insufficient" for null
 * so the row still crosses the stamping predicate (never re-selected).
 */
export interface CampaignFingerprintInput {
  registrar: string | null;
  nameServers: string[] | null | undefined;
  asn: string | null;
  ctIssuer: string | null;
}

/** Registrable root of a nameserver host, e.g. ns1.cloudflare.com →
 *  cloudflare.com. Handles the common 2-level ccTLD SLDs (.com.au, .co.uk). */
function nsRoot(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const SECOND_LEVEL = new Set([
    "com", "net", "org", "co", "gov", "edu", "ac",
  ]);
  // If the second-to-last label is a known SLD (e.g. "com" in x.com.au),
  // keep three labels; otherwise two.
  const penultimate = labels[labels.length - 2];
  const take = SECOND_LEVEL.has(penultimate) ? 3 : 2;
  return labels.slice(-take).join(".");
}

export function computeCampaignKey(
  i: CampaignFingerprintInput,
): string | null {
  const parts: string[] = [];

  const reg = canonicalRegistrar(i.registrar);
  if (reg) parts.push(`r:${reg.toLowerCase()}`);

  const roots = Array.from(
    new Set((i.nameServers ?? []).map((n) => nsRoot(String(n))).filter(Boolean)),
  ).sort();
  if (roots.length > 0) parts.push(`ns:${roots.join(",")}`);

  if (i.asn) parts.push(`asn:${String(i.asn).toLowerCase()}`);
  if (i.ctIssuer) parts.push(`ci:${i.ctIssuer.toLowerCase()}`);

  // < 2 distinct components → too weak to cluster on.
  if (parts.length < 2) return null;

  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

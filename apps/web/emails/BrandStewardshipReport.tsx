import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Link,
  Hr,
  Heading,
} from "@react-email/components";
import { renderCopySlot } from "@/lib/email/resolve-copy";
import { BRAND_STEWARDSHIP_SLOTS } from "@/lib/email/copy-registry";
import {
  registrarAbuseUrl,
  hostAbuseUrl,
  ICANN_COMPLAINT_URL,
} from "@/lib/email/registrar-abuse";
import { withUtm } from "@/lib/utm";

const CTA_UTM = {
  source: "email",
  medium: "email",
  campaign: "brand-stewardship",
} as const;

const TRUSTPILOT_URL = "https://au.trustpilot.com/evaluate/askarthur.au";
const LINKEDIN_URL = "https://www.linkedin.com/company/askarthur";
/** Partnership enquiry destination. /for-business doesn't exist yet; /contact
 *  is the live partnership-enquiry surface. Swap here if a /for-business or
 *  /partner page ships. */
const PARTNERSHIP_URL = "https://askarthur.au/contact";

export interface BrandStewardshipReportProps {
  brandName: string;
  /** Human period label, e.g. "May 2026". */
  periodLabel: string;
  /** metrics.detected — distinct scam_reports impersonating the brand. */
  detected: number;
  /** metrics.reported_by_destination — { openphish: n, apwg: n, ... }. */
  reportedByDestination: Record<string, number>;
  /** metrics.reports_sent — total onward reports we actually sent. */
  reportsSent: number;
  /** Up to ~3 example impersonating domains (send route joins scam_reports). */
  sampleDomains?: string[];
  /**
   * Clone-watch lookalike-domain detections for the period, with hosting +
   * registrar attribution so the brand can action takedowns themselves.
   * metrics.clones — populated by report-brand-stewardship's clone aggregation.
   */
  cloneDetections?: CloneDetections;
  /** Correlation ref, e.g. "BSR-7_eleven-2026-05". */
  reportRef: string;
  /** Public read-only share page URL (forward-to-your-team). When present, a
   *  "Share with your team" link + a CTA pointing here are rendered. */
  shareUrl?: string;
  /** Unsubscribe / STOP mailto. */
  stopUrl?: string;
  /** Editable prose overrides (Email Studio). Falls back to slot defaults. */
  copy?: Record<string, string>;
}

export interface CloneDetectionRow {
  /** The lookalike domain, e.g. "login-anz-rewards.click". */
  domain: string;
  /** urlscan classification: likely_phishing | parked_for_sale | neutral | null. */
  classification: string | null;
  /** Hosting IP from the urlscan render. */
  ip: string | null;
  /** Hosting ASN, e.g. "AS132203". */
  asn: string | null;
  /** Two-letter hosting country. */
  country: string | null;
  /** Domain registrar (WHOIS), e.g. "NameSilo, LLC". */
  registrar: string | null;
  /** Registrar abuse contact the brand can email for takedown. */
  abuseEmail: string | null;
}

export interface CloneDetections {
  /** Total distinct lookalike domains detected this period. */
  detected: number;
  /** Per-classification counts for the headline. */
  byClassification?: Record<string, number>;
  /** Consumable analytics — counts across ALL clones (not just the shown
   *  detail rows). Drives the breakdown bars. */
  byCountry?: Record<string, number>;
  byRegistrar?: Record<string, number>;
  byAsn?: Record<string, number>;
  /** Per-clone detail rows (already capped by the caller, ~25). */
  domains: CloneDetectionRow[];
}

/**
 * Monthly Brand Stewardship Report — "here's what Ask Arthur detected and
 * reported on your behalf this month." The partnership-opener email to a
 * brand's security / fraud team.
 *
 * Visual chrome matches CloneWatchBrandAlert.tsx (navy header card, Public
 * Sans, teal accents, 560px container, ABN footer) so all outbound Ask Arthur
 * emails share the same look.
 *
 * Honesty: factual verbs only — "detected" / "reported". We NEVER claim a
 * takedown (these are fire-and-forget blocklist forwards with no callback).
 *
 * NOTE: the prose blocks marked `DRAFT COPY — pending #371` use placeholder
 * wording until the lawyer-vetted brand-outreach language pack (#371) lands.
 * This template is inert until the #537 send route + FF_BRAND_STEWARDSHIP_REPORT.
 */
export default function BrandStewardshipReport({
  brandName,
  periodLabel,
  detected,
  reportedByDestination,
  reportsSent,
  sampleDomains,
  cloneDetections,
  reportRef,
  shareUrl,
  stopUrl,
  copy,
}: BrandStewardshipReportProps) {
  const slot = (key: keyof typeof BRAND_STEWARDSHIP_SLOTS) =>
    renderCopySlot(copy?.[key] ?? BRAND_STEWARDSHIP_SLOTS[key].default, {
      brandName,
      periodLabel,
    });
  const stopMailto =
    stopUrl ??
    `mailto:brendan@askarthur.au?subject=${encodeURIComponent(
      `STOP brand-stewardship reports — ${brandName}`,
    )}`;

  const destinations = Object.entries(reportedByDestination).filter(
    ([, n]) => n > 0,
  );

  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>
        {brandName} brand-protection summary — {periodLabel}
      </Preview>
      <Body
        style={{
          backgroundColor: "#F8FAFC",
          fontFamily:
            "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
          {/* Header */}
          <Section
            style={{
              backgroundColor: "#1B2A4A",
              borderRadius: "8px 8px 0 0",
              padding: "24px 28px",
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "2px",
                textTransform: "uppercase" as const,
                margin: 0,
              }}
            >
              Ask Arthur
            </Text>
            <Heading
              as="h1"
              style={{ color: "#FFFFFF", fontSize: "22px", fontWeight: 700, margin: "8px 0 2px 0" }}
            >
              Monthly brand-protection summary
            </Heading>
            <Text style={{ color: "#B8C1D1", fontSize: "14px", margin: 0 }}>
              {brandName} &middot; {periodLabel}
            </Text>
          </Section>

          {/* Body */}
          <Section
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "0 0 8px 8px",
              padding: "28px",
              border: "1px solid #E2E8F0",
              borderTop: "none",
            }}
          >
            {/* Editable slot: greeting (Email Studio; falls back to default) */}
            <div
              style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", margin: "0 0 20px 0" }}
              dangerouslySetInnerHTML={{ __html: slot("greeting") }}
            />

            {/* Stat block */}
            <Section
              style={{
                backgroundColor: "#F8FAFC",
                border: "1px solid #E2E8F0",
                borderRadius: "8px",
                padding: "20px 24px",
                margin: "0 0 20px 0",
              }}
            >
              <Text style={{ color: "#1B2A4A", fontSize: "32px", fontWeight: 700, margin: 0 }}>
                {detected}
              </Text>
              <Text style={{ color: "#475569", fontSize: "14px", margin: "2px 0 0 0" }}>
                domain{detected === 1 ? "" : "s"} detected impersonating{" "}
                {brandName}
              </Text>
              <Hr style={{ borderColor: "#E2E8F0", margin: "16px 0" }} />
              <Text style={{ color: "#1B2A4A", fontSize: "14px", fontWeight: 700, margin: "0 0 6px 0" }}>
                Reported on your behalf ({reportsSent} report
                {reportsSent === 1 ? "" : "s"})
              </Text>
              {destinations.length > 0 ? (
                destinations.map(([dest, n]) => (
                  <Text
                    key={dest}
                    style={{ color: "#475569", fontSize: "14px", lineHeight: "1.6", margin: 0 }}
                  >
                    &middot; {humaniseDestination(dest)} — {n}
                  </Text>
                ))
              ) : (
                <Text style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>
                  No outbound reports this period.
                </Text>
              )}
            </Section>

            {sampleDomains && sampleDomains.length > 0 && (
              <Section style={{ margin: "0 0 20px 0" }}>
                <Text style={labelStyle}>
                  Examples (of {detected})
                </Text>
                {sampleDomains.slice(0, 3).map((d) => (
                  <Text key={d} style={{ margin: "0 0 4px 0" }}>
                    <code style={codeInline}>{d}</code>
                  </Text>
                ))}
              </Section>
            )}

            {/* Clone-watch lookalike domains with hosting + registrar so the
                brand can file takedowns directly. Honesty: "detected", not
                "malicious" — classification is urlscan's, shown verbatim. */}
            {cloneDetections && cloneDetections.detected > 0 && (
              <Section style={{ margin: "0 0 4px 0" }}>
                <Text style={labelStyle}>
                  Lookalike domains &amp; where they&apos;re hosted
                </Text>
                <Text style={{ color: "#475569", fontSize: "13px", lineHeight: "1.5", margin: "0 0 12px 0" }}>
                  Hosting and registrar details for each lookalike let your team
                  file takedowns directly with the host or registrar.
                </Text>

                {/* Consumable analytics — where the clones are hosted +
                    registered, at a glance. Pure inline-CSS bars so every email
                    client renders them; the share page has the interactive
                    version. */}
                <BreakdownBars
                  title="Where they're hosted (country)"
                  data={cloneDetections.byCountry}
                />
                <BreakdownBars
                  title="Who registered them"
                  data={cloneDetections.byRegistrar}
                  linkFor={(label) =>
                    registrarAbuseUrl(label) ?? ICANN_COMPLAINT_URL
                  }
                />
                <BreakdownBars
                  title="Hosting network (ASN)"
                  data={cloneDetections.byAsn}
                  linkFor={(label) => hostAbuseUrl(label)}
                />

                {shareUrl && (
                  <Text style={{ margin: "4px 0 14px 0" }}>
                    <Link
                      href={shareUrl}
                      style={{ color: "#0F766E", fontSize: "13px", fontWeight: 700 }}
                    >
                      Share this breakdown with your team →
                    </Link>
                  </Text>
                )}

                {cloneDetections.domains.map((c) => (
                  <Section
                    key={c.domain}
                    style={{
                      borderLeft: `3px solid ${classColor(c.classification)}`,
                      backgroundColor: "#F8FAFC",
                      borderRadius: "4px",
                      padding: "10px 14px",
                      margin: "0 0 8px 0",
                    }}
                  >
                    <Text style={{ margin: "0 0 3px 0" }}>
                      <code style={codeInline}>{c.domain}</code>
                      {c.classification && (
                        <span
                          style={{
                            marginLeft: "8px",
                            fontSize: "11px",
                            fontWeight: 700,
                            color: classColor(c.classification),
                            textTransform: "uppercase" as const,
                          }}
                        >
                          {classLabel(c.classification)}
                        </span>
                      )}
                    </Text>
                    <Text style={{ color: "#64748B", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
                      {hostingLine(c)}
                    </Text>
                    {(c.registrar || c.abuseEmail) && (
                      <Text style={{ color: "#64748B", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
                        Registrar: {c.registrar ?? "unknown"}
                        {c.abuseEmail && (
                          <>
                            {" — abuse: "}
                            <Link href={`mailto:${c.abuseEmail}`} style={{ color: "#0F766E" }}>
                              {c.abuseEmail}
                            </Link>
                          </>
                        )}
                      </Text>
                    )}
                    {/* One-click abuse-report channels: registrar (or ICANN
                        fallback) + host where we know a self-serve form. */}
                    <Text style={{ fontSize: "12px", lineHeight: "1.5", margin: "2px 0 0 0" }}>
                      <Link
                        href={registrarAbuseUrl(c.registrar) ?? ICANN_COMPLAINT_URL}
                        style={{ color: "#0F766E", fontWeight: 700 }}
                      >
                        Report to registrar →
                      </Link>
                      {hostAbuseUrl(c.asn) && (
                        <>
                          {"  ·  "}
                          <Link
                            href={hostAbuseUrl(c.asn) as string}
                            style={{ color: "#0F766E", fontWeight: 700 }}
                          >
                            Report to host →
                          </Link>
                        </>
                      )}
                    </Text>
                  </Section>
                ))}
                {cloneDetections.detected > cloneDetections.domains.length && (
                  <Text style={{ color: "#94A3B8", fontSize: "12px", margin: "4px 0 0 0" }}>
                    + {cloneDetections.detected - cloneDetections.domains.length} more
                    lookalike{cloneDetections.detected - cloneDetections.domains.length === 1 ? "" : "s"} —
                    full list available on request.
                  </Text>
                )}
              </Section>
            )}

            <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />

            <Heading
              as="h3"
              style={{ color: "#1B2A4A", fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0" }}
            >
              What we do
            </Heading>
            {/* Editable slot: what_we_do */}
            <div
              style={{ color: "#334155", fontSize: "14px", lineHeight: "1.6", margin: "0 0 16px 0" }}
              dangerouslySetInnerHTML={{ __html: slot("what_we_do") }}
            />

            <Heading
              as="h3"
              style={{ color: "#1B2A4A", fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0" }}
            >
              Working together
            </Heading>
            {/* Editable slot: working_together */}
            <div
              style={{ color: "#334155", fontSize: "14px", lineHeight: "1.6", margin: "0 0 8px 0" }}
              dangerouslySetInnerHTML={{ __html: slot("working_together") }}
            />

            {/* CTA card — feedback / shout-out / partnership. Links UTM-tagged
                so Plausible attributes them to this email. */}
            <Section
              style={{
                backgroundColor: "#1B2A4A",
                borderRadius: "8px",
                padding: "20px 24px",
                margin: "20px 0 0 0",
              }}
            >
              <Heading
                as="h3"
                style={{ color: "#FFFFFF", fontSize: "15px", fontWeight: 700, margin: "0 0 6px 0" }}
              >
                Was this useful?
              </Heading>
              <div
                style={{ color: "#B8C1D1", fontSize: "13px", lineHeight: "1.6", margin: "0 0 12px 0" }}
                dangerouslySetInnerHTML={{ __html: slot("partnership") }}
              />
              <Text style={{ margin: 0, lineHeight: "1.8" }}>
                <Link
                  href={withUtm(TRUSTPILOT_URL, CTA_UTM)}
                  style={ctaLink}
                >
                  Leave a Trustpilot review →
                </Link>
                <br />
                <Link href={withUtm(LINKEDIN_URL, CTA_UTM)} style={ctaLink}>
                  Give us a shout-out on LinkedIn →
                </Link>
                <br />
                <Link href={withUtm(PARTNERSHIP_URL, CTA_UTM)} style={ctaLink}>
                  Explore a partnership →
                </Link>
              </Text>
            </Section>

            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0" }} />

            <Text style={{ color: "#64748B", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
              This is a factual summary of detections and reports, not a
              determination that any domain is malicious. Ask Arthur is operated
              in accordance with the Australian Privacy Act 1988 (Cth). Ref:{" "}
              <code style={codeInline}>{reportRef}</code>
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: "12px", margin: "16px 0 0 0" }}>
              You&apos;re receiving this monthly summary because Ask Arthur
              tracks domains impersonating <strong>{brandName}</strong>.{" "}
              <Link href={stopMailto} style={{ color: "#94A3B8" }}>
                Stop these reports
              </Link>
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: "12px", lineHeight: "1.5", margin: "8px 0 0 0" }}>
              Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const codeInline = {
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: "12px",
  color: "#0F172A",
  backgroundColor: "#F1F5F9",
  padding: "1px 4px",
  borderRadius: "3px",
} as const;

const ctaLink = {
  color: "#7DD3C0",
  fontSize: "13px",
  fontWeight: 700,
  textDecoration: "none" as const,
} as const;

/**
 * Inline-CSS horizontal bar breakdown — one row per category, sorted desc,
 * top 6, "Unknown" sunk to the bottom. Email-client-safe (no SVG/JS): a track
 * div + a filled div sized by percentage. `linkFor` optionally turns each
 * label into an abuse-report link (used for the registrar breakdown).
 */
function BreakdownBars({
  title,
  data,
  linkFor,
}: {
  title: string;
  data?: Record<string, number>;
  linkFor?: (label: string) => string | null;
}) {
  const entries = Object.entries(data ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => {
    // Keep "Unknown" last regardless of count — it's the least actionable.
    if (a[0] === "Unknown" && b[0] !== "Unknown") return 1;
    if (b[0] === "Unknown" && a[0] !== "Unknown") return -1;
    return b[1] - a[1];
  });
  const top = entries.slice(0, 6);
  const max = Math.max(...top.map(([, n]) => n));

  return (
    <Section style={{ margin: "0 0 14px 0" }}>
      <Text
        style={{
          fontSize: "11px",
          textTransform: "uppercase" as const,
          color: "#64748B",
          letterSpacing: "0.05em",
          margin: "0 0 6px 0",
          fontWeight: 700,
        }}
      >
        {title}
      </Text>
      {top.map(([label, n]) => {
        const pct = Math.max(6, Math.round((n / max) * 100));
        const href = linkFor?.(label) ?? null;
        return (
          <Section key={label} style={{ margin: "0 0 5px 0" }}>
            <Text style={{ fontSize: "12px", color: "#334155", margin: "0 0 2px 0" }}>
              {href ? (
                <Link href={href} style={{ color: "#0F766E" }}>
                  {label}
                </Link>
              ) : (
                label
              )}{" "}
              <span style={{ color: "#94A3B8" }}>· {n}</span>
            </Text>
            <div
              style={{
                backgroundColor: "#E2E8F0",
                borderRadius: "3px",
                height: "8px",
                width: "100%",
              }}
            >
              <div
                style={{
                  backgroundColor: "#0F766E",
                  borderRadius: "3px",
                  height: "8px",
                  width: `${pct}%`,
                }}
              />
            </div>
          </Section>
        );
      })}
    </Section>
  );
}

const labelStyle = {
  fontSize: "12px",
  textTransform: "uppercase" as const,
  color: "#64748B",
  letterSpacing: "0.05em",
  margin: "0 0 6px 0",
} as const;

/** Accent colour per urlscan classification (left border + chip). */
function classColor(classification: string | null): string {
  switch (classification) {
    case "likely_phishing":
      return "#DC2626"; // red
    case "parked_for_sale":
      return "#D97706"; // amber
    default:
      return "#64748B"; // slate (neutral / unknown)
  }
}

/** Human label for a urlscan classification chip. */
function classLabel(classification: string | null): string {
  switch (classification) {
    case "likely_phishing":
      return "Likely phishing";
    case "parked_for_sale":
      return "Parked for sale";
    case "neutral":
      return "Resolves";
    case "unresolved":
      return "Unresolved";
    default:
      return classification ?? "";
  }
}

/** "Hosted: <ip> · <ASN> · <country>" with graceful fallback. */
function hostingLine(c: CloneDetectionRow): string {
  const parts = [c.ip, c.asn, c.country].filter(Boolean) as string[];
  return parts.length > 0 ? `Hosted: ${parts.join(" · ")}` : "Hosting: not captured";
}

/** Map onward_report_log destination keys to human labels. */
function humaniseDestination(dest: string): string {
  switch (dest) {
    case "openphish":
      return "OpenPhish community blocklist";
    case "apwg":
      return "APWG eCrime Exchange";
    case "acma_email_spam":
      return "ACMA spam intake";
    case "brand_abuse":
      return "your security team";
    case "scamwatch":
      return "Scamwatch";
    case "reportcyber":
      return "ReportCyber";
    default:
      return dest;
  }
}

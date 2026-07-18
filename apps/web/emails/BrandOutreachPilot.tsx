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
import { lifecycleBadge } from "@/lib/clone-watch/outcome-copy";

/**
 * One clone-detection row for the outreach sample table. A lean, presentation-
 * ready shape (the fetch/rank logic in lib/email/brand-outreach-pilot.ts maps
 * a `shopfront_clone_alerts` row into this). Every field is a factual, machine-
 * derived observation — no characterisation of a registrant (brand-comms legal
 * pack, Axis A).
 */
export interface CloneSampleRow {
  /** The lookalike domain, e.g. "reece-rewards.click". */
  domain: string;
  /** shopfront_clone_alerts.lifecycle_state — drives the honesty badge. */
  lifecycleState: string | null;
  /** urlscan classification: likely_phishing | parked_for_sale | neutral | null. */
  classification: string | null;
  /** first_seen_at ISO — when Ask Arthur first detected the domain. */
  detectedAt: string | null;
  /** True when we forwarded it to Netcraft (browser / blocklist) on their behalf. */
  reportedToNetcraft: boolean;
  /** Domain registrar (WHOIS), e.g. "NameSilo, LLC" — null when not captured. */
  registrar: string | null;
  /** Compact hosting line "IP · ASN · CC" — null when not captured. */
  host: string | null;
  /** Public urlscan result page (evidence) — null when no scan uuid. */
  resultUrl: string | null;
}

/**
 * The brand's clone-detection sample for the outreach email. Counts always
 * reflect the true totals over the window; `rows` is the small, ranked sample
 * shown in the email (actioned / reported clones first).
 */
export interface BrandCloneSample {
  /** The brand's legit domain the sample was drawn for (inferred_target_domain). */
  brandDomain: string;
  /** Look-back window, days (30). */
  windowDays: number;
  /** Distinct lookalike domains detected for the brand in the window. */
  totalCount: number;
  /** Distinct lookalikes we actioned / reported on their behalf in the window. */
  reportedCount: number;
  /** Distinct lookalikes our scans confirmed serving active phishing. */
  weaponisedCount: number;
  /** Distinct lookalikes Netcraft actioned (taken down). */
  takenDownCount: number;
  /** The ranked sample (≤ CLONE_SAMPLE_SIZE rows). */
  rows: CloneSampleRow[];
  /** True when reportedCount is below the "enough data to pitch" floor —
   *  drives the composer warning; NOT a hard block. */
  insufficientData: boolean;
}

export interface BrandOutreachPilotProps {
  brandName: string;
  /** Founder's pitch prose (the offer + a filled {{hook}} greeting), already
   *  sanitised markdown→HTML via renderCopySlot. Rendered as the opening body. */
  bodyHtml: string;
  /** The real clone sample for this brand. Omitted → the sample section and its
   *  intro are dropped entirely (the email is then pitch + signature only). */
  cloneSample?: BrandCloneSample;
  /** Unsubscribe / STOP mailto or signed URL. */
  stopUrl?: string;
}

const ASK_ARTHUR_ABN = "72 695 772 313";

/**
 * Cold pilot-outreach email (Surface 1 in docs/policy/brand-comms-legal-review-
 * pack.md) — the founder's first personal contact with a prospect brand,
 * offering the clone-watch pilot AND proving the value with a real sample of
 * the lookalike domains Ask Arthur has already detected + reported for them.
 *
 * Visual chrome matches BrandStewardshipReport / CloneWatchBrandAlert (navy
 * header card, Public Sans, teal accents, 560px container, ABN footer) so every
 * outbound Ask Arthur email shares one look — this replaces the previous
 * unstyled plain-text wrapper (buildOutreachEmail).
 *
 * Honesty (brand-comms legal pack, Axis A + D): factual, machine-derived verbs
 * only — "detected" / "reported" / lifecycle badges from outcome-copy.ts. The
 * sample is framed as "evidence of OUR detections and actions", never an
 * assessment of the brand's SPF compliance, and never a claim that a registrant
 * is a criminal. The founder still authors + four-eyes every send.
 */
export default function BrandOutreachPilot({
  brandName,
  bodyHtml,
  cloneSample,
  stopUrl,
}: BrandOutreachPilotProps) {
  const stopMailto =
    stopUrl ??
    `mailto:brendan@askarthur.au?subject=${encodeURIComponent(`STOP — ${brandName}`)}`;

  const sample = cloneSample && cloneSample.rows.length > 0 ? cloneSample : null;

  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>
        {brandName} × Ask Arthur — a clone-watch pilot, with real evidence
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
              Protecting {brandName} from lookalike domains
            </Heading>
            <Text style={{ color: "#B8C1D1", fontSize: "14px", margin: 0 }}>
              A clone-watch pilot — with real evidence
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
            {/* Founder pitch prose (offer + hook), sanitised markdown → HTML. */}
            <div
              style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", margin: "0 0 20px 0" }}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />

            {sample && (
              <Section style={{ margin: "0 0 8px 0" }}>
                <Hr style={{ borderColor: "#E2E8F0", margin: "0 0 20px 0" }} />
                <Heading
                  as="h2"
                  style={{ color: "#1B2A4A", fontSize: "17px", fontWeight: 700, margin: "0 0 6px 0" }}
                >
                  A sample of the clones we&apos;ve reported for {brandName} in
                  the last {sample.windowDays} days
                </Heading>
                <Text
                  style={{ color: "#475569", fontSize: "14px", lineHeight: "1.6", margin: "0 0 16px 0" }}
                >
                  Over the last {sample.windowDays} days our system detected{" "}
                  <strong>{sample.totalCount}</strong> lookalike domain
                  {sample.totalCount === 1 ? "" : "s"} designed to resemble{" "}
                  {brandName}, and reported{" "}
                  <strong>{sample.reportedCount}</strong> of them for
                  browser / blocklist protection on your behalf. A few examples
                  are below — this is evidence of Ask Arthur&apos;s own detections
                  and actions, not an assessment of your organisation&apos;s
                  compliance.
                </Text>

                {/* Stat strip — the two numbers that prove volume + action. */}
                <Section
                  style={{
                    backgroundColor: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    padding: "14px 18px",
                    margin: "0 0 18px 0",
                  }}
                >
                  <Text style={{ color: "#334155", fontSize: "14px", lineHeight: "1.7", margin: 0 }}>
                    <strong style={{ color: "#1B2A4A" }}>{sample.totalCount}</strong> detected
                    {"  ·  "}
                    <strong style={{ color: "#1B2A4A" }}>{sample.reportedCount}</strong> reported
                    on your behalf
                    {sample.weaponisedCount > 0 && (
                      <>
                        {"  ·  "}
                        <strong style={{ color: "#DC2626" }}>
                          {sample.weaponisedCount}
                        </strong>{" "}
                        serving active phishing
                      </>
                    )}
                    {sample.takenDownCount > 0 && (
                      <>
                        {"  ·  "}
                        <strong style={{ color: "#16A34A" }}>
                          {sample.takenDownCount}
                        </strong>{" "}
                        taken down
                      </>
                    )}
                  </Text>
                </Section>

                {sample.rows.map((c) => {
                  const badge = lifecycleBadge(c.lifecycleState);
                  return (
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
                        {badge && (
                          <span
                            style={{
                              marginLeft: "8px",
                              fontSize: "11px",
                              fontWeight: 700,
                              color: badge.color,
                            }}
                          >
                            {badge.label}
                          </span>
                        )}
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
                        {c.detectedAt && <>Detected {fmtDate(c.detectedAt)}</>}
                        {c.detectedAt && c.reportedToNetcraft && " · "}
                        {c.reportedToNetcraft && <>reported for takedown</>}
                        {c.resultUrl && (
                          <>
                            {" · "}
                            <Link href={c.resultUrl} style={{ color: "#0F766E" }}>
                              View evidence →
                            </Link>
                          </>
                        )}
                      </Text>
                      {(c.host || c.registrar) && (
                        <Text
                          style={{ color: "#64748B", fontSize: "12px", lineHeight: "1.5", margin: 0 }}
                        >
                          {c.host && <>Hosted: {c.host}</>}
                          {c.host && c.registrar && " · "}
                          {c.registrar && <>Registrar: {c.registrar}</>}
                        </Text>
                      )}
                    </Section>
                  );
                })}

                {sample.totalCount > sample.rows.length && (
                  <Text style={{ color: "#94A3B8", fontSize: "12px", margin: "4px 0 0 0" }}>
                    + {sample.totalCount - sample.rows.length} more lookalike
                    {sample.totalCount - sample.rows.length === 1 ? "" : "s"} —
                    the full list, with hosting and registrar for each, comes
                    with the pilot.
                  </Text>
                )}
              </Section>
            )}

            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0 16px 0" }} />

            {/* Signature */}
            <Text style={{ color: "#1B2A4A", fontSize: "14px", lineHeight: "1.6", margin: "0 0 4px 0" }}>
              Brendan
              <br />
              Founder, Ask Arthur
              <br />
              <Link href="https://askarthur.au" style={{ color: "#0F766E", textDecoration: "none" }}>
                askarthur.au
              </Link>
            </Text>

            <Text style={{ color: "#94A3B8", fontSize: "12px", lineHeight: "1.5", margin: "16px 0 0 0" }}>
              Ask Arthur | ABN {ASK_ARTHUR_ABN} | Sydney, Australia
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: "12px", lineHeight: "1.5", margin: "8px 0 0 0" }}>
              Sent to {brandName} as a one-off business enquiry about domains
              impersonating your brand.{" "}
              <Link href={stopMailto} style={{ color: "#94A3B8", textDecoration: "underline" }}>
                Reply STOP
              </Link>{" "}
              and I won&apos;t contact you again.
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

/** Short date ("11 Jul 2026"). Formatted from UTC parts so renders are
 *  deterministic across Node ICU builds (matches BrandStewardshipReport). */
const FMT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${FMT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Accent colour per urlscan classification (left border + chip). */
function classColor(classification: string | null): string {
  switch (classification) {
    case "likely_phishing":
      return "#DC2626";
    case "parked_for_sale":
      return "#D97706";
    default:
      return "#64748B";
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

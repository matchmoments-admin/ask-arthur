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
  /** Correlation ref, e.g. "BSR-7_eleven-2026-05". */
  reportRef: string;
  /** Unsubscribe / STOP mailto. */
  stopUrl?: string;
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
  reportRef,
  stopUrl,
}: BrandStewardshipReportProps) {
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
            {/* DRAFT COPY — pending #371 */}
            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", margin: "0 0 20px 0" }}>
              Hello <strong>{brandName}</strong> team — here&apos;s what Ask
              Arthur, an Australian scam-detection service, detected and
              reported on your behalf in <strong>{periodLabel}</strong>.
            </Text>

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

            <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />

            <Heading
              as="h3"
              style={{ color: "#1B2A4A", fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0" }}
            >
              What we do
            </Heading>
            {/* DRAFT COPY — pending #371 */}
            <Text style={{ color: "#334155", fontSize: "14px", lineHeight: "1.6", margin: "0 0 16px 0" }}>
              Ask Arthur proactively surfaces domains impersonating Australian
              brands and forwards the suspected phishing URLs to neutral
              community blocklists (such as OpenPhish and APWG) in the public
              interest, at no cost to you. We do not file takedowns on your
              behalf and we make no determination that any domain is malicious —
              we share factual signals so your fraud / takedown team can act.
            </Text>

            {/* DRAFT COPY — pending #371 */}
            <Heading
              as="h3"
              style={{ color: "#1B2A4A", fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0" }}
            >
              Working together
            </Heading>
            <Text style={{ color: "#334155", fontSize: "14px", lineHeight: "1.6", margin: "0 0 8px 0" }}>
              We keep a full evidence record for every domain above. Reply to
              this email if you&apos;d like the underlying evidence pack, a
              different report format, or to discuss working together more
              closely.
            </Text>

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

const labelStyle = {
  fontSize: "12px",
  textTransform: "uppercase" as const,
  color: "#64748B",
  letterSpacing: "0.05em",
  margin: "0 0 6px 0",
} as const;

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

import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Link,
  Hr,
} from "@react-email/components";

export interface BrandAbuseReportProps {
  brandName: string;
  scamType: string;
  channel: string;
  scammerUrls: string[];
  scammerPhones: string[];
  scammerEmails: string[];
  redactedContent: string;
  redFlags: string[];
  receivedAt: string;
  reportRef: string;
}

/**
 * Formal letter to a brand security team. Sent only when known_brands lists
 * the brand as contact_type='email' AND the manual-review gate has passed.
 *
 * The body is deliberately conservative — no marketing, no calls-to-action.
 * Brand security teams treat unsolicited mail with prejudice; the goal is to
 * read like an authentic abuse report, not a content-marketing email.
 */
export default function BrandAbuseReport({
  brandName,
  scamType,
  channel,
  scammerUrls,
  scammerPhones,
  scammerEmails,
  redactedContent,
  redFlags,
  receivedAt,
  reportRef,
}: BrandAbuseReportProps) {
  const allContacts = [...scammerPhones, ...scammerEmails];
  return (
    <Html>
      <Head />
      <Preview>
        Scam impersonating {brandName} — Ask Arthur ref {reportRef}
      </Preview>
      <Body
        style={{
          fontFamily:
            "Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "#0F172A",
          backgroundColor: "#FFFFFF",
        }}
      >
        <Container
          style={{
            maxWidth: "640px",
            margin: "0 auto",
            padding: "32px 24px",
          }}
        >
          <Heading
            as="h2"
            style={{ fontSize: "20px", margin: "0 0 16px 0" }}
          >
            Scam impersonating {brandName}
          </Heading>

          <Text style={{ fontSize: "14px", lineHeight: 1.6 }}>
            Hello {brandName} security team,
          </Text>

          <Text style={{ fontSize: "14px", lineHeight: 1.6 }}>
            A member of the Australian public reported a communication
            impersonating {brandName} via Ask Arthur (askarthur.au), an
            Australian scam-detection service. We&apos;re forwarding the
            evidence so you can action takedowns or customer alerts as
            appropriate. The reporter has consented to this forward; their
            personal details have been removed.
          </Text>

          <Section style={{ marginTop: "24px" }}>
            <Heading
              as="h3"
              style={{ fontSize: "16px", margin: "0 0 12px 0" }}
            >
              Evidence
            </Heading>
            <Row label="Scam type" value={scamType || "—"} />
            <Row label="Received via" value={channel || "—"} />
            <Row label="Received at" value={receivedAt} />
            <Row label="Ask Arthur ref" value={reportRef} />
          </Section>

          {scammerUrls.length > 0 && (
            <Section style={{ marginTop: "16px" }}>
              <Text style={labelStyle}>Scammer URLs</Text>
              <Text style={blockStyle}>{scammerUrls.join("\n")}</Text>
            </Section>
          )}

          {allContacts.length > 0 && (
            <Section style={{ marginTop: "16px" }}>
              <Text style={labelStyle}>Scammer contacts</Text>
              <Text style={blockStyle}>{allContacts.join("\n")}</Text>
            </Section>
          )}

          {redFlags.length > 0 && (
            <Section style={{ marginTop: "16px" }}>
              <Text style={labelStyle}>Red flags identified</Text>
              <Text style={blockStyle}>
                {redFlags.map((f) => `• ${f}`).join("\n")}
              </Text>
            </Section>
          )}

          <Section style={{ marginTop: "16px" }}>
            <Text style={labelStyle}>Message content (PII-redacted)</Text>
            <Text style={blockStyle}>{redactedContent || "—"}</Text>
          </Section>

          <Hr style={{ borderColor: "#E2E8F0", margin: "32px 0 16px 0" }} />

          <Text style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.6 }}>
            Ask Arthur also forwards aggregated intelligence to the Australian
            National Anti-Scam Centre (Scamwatch). For questions or takedown
            confirmations, reply to this email or contact{" "}
            <Link href="mailto:brendan@askarthur.au" style={{ color: "#0F766E" }}>
              brendan@askarthur.au
            </Link>
            . Ask Arthur is operated in accordance with the Australian Privacy
            Act 1988 (Cth).
          </Text>
          <Text style={{ fontSize: "12px", color: "#64748B" }}>
            <Link href="https://askarthur.au/privacy" style={{ color: "#0F766E" }}>
              Privacy
            </Link>{" "}
            ·{" "}
            <Link href="https://askarthur.au" style={{ color: "#0F766E" }}>
              askarthur.au
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const labelStyle = {
  fontSize: "12px",
  textTransform: "uppercase" as const,
  color: "#64748B",
  letterSpacing: "0.05em",
  margin: "0 0 4px 0",
};

const blockStyle = {
  fontSize: "13px",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap" as const,
  backgroundColor: "#F8FAFC",
  padding: "12px",
  borderRadius: "6px",
  margin: "0",
  fontFamily:
    "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text
      style={{
        fontSize: "13px",
        margin: "4px 0",
        lineHeight: 1.5,
      }}
    >
      <span style={{ color: "#64748B", display: "inline-block", width: "120px" }}>
        {label}
      </span>
      <span style={{ color: "#0F172A" }}>{value}</span>
    </Text>
  );
}

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
import { renderCopySlot } from "@/lib/email/resolve-copy";
import { BRAND_ABUSE_SLOTS } from "@/lib/email/copy-registry";

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
  /** Editable prose overrides (Email Studio). Falls back to slot defaults. */
  copy?: Record<string, string>;
}

/**
 * Formal letter to a brand security team. Sent only when known_brands lists
 * the brand as contact_type='email' AND the manual-review gate has passed.
 *
 * The body is deliberately conservative — no marketing, no calls-to-action.
 * Brand security teams treat unsolicited mail with prejudice; the goal is to
 * read like an authentic abuse report, not a content-marketing email.
 *
 * Chrome refreshed 2026-05-29 to match the shared Ask Arthur house style
 * (navy header card + Public Sans + teal links + ABN footer, as in
 * CloneWatchBrandAlert.tsx). Body copy + tone are unchanged.
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
  copy,
}: BrandAbuseReportProps) {
  const allContacts = [...scammerPhones, ...scammerEmails];
  const slot = (key: keyof typeof BRAND_ABUSE_SLOTS) =>
    renderCopySlot(copy?.[key] ?? BRAND_ABUSE_SLOTS[key].default, { brandName });
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>
        Scam impersonating {brandName} — Ask Arthur ref {reportRef}
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
              style={{ color: "#FFFFFF", fontSize: "22px", fontWeight: 700, margin: "8px 0 0 0" }}
            >
              Scam impersonating {brandName}
            </Heading>
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
            {/* Editable slot: greeting */}
            <div
              style={{ color: "#334155", fontSize: "14px", lineHeight: 1.6, margin: "0 0 14px 0" }}
              dangerouslySetInnerHTML={{ __html: slot("greeting") }}
            />

            {/* Editable slot: intro */}
            <div
              style={{ color: "#334155", fontSize: "14px", lineHeight: 1.6, margin: "0 0 14px 0" }}
              dangerouslySetInnerHTML={{ __html: slot("intro") }}
            />

            <Section style={{ marginTop: "20px" }}>
              <Heading as="h3" style={{ color: "#1B2A4A", fontSize: "16px", margin: "0 0 12px 0" }}>
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

            <Hr style={{ borderColor: "#E2E8F0", margin: "28px 0 16px 0" }} />

            <Text style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.6, margin: 0 }}>
              Ask Arthur also forwards aggregated intelligence to the Australian
              National Anti-Scam Centre (Scamwatch). For questions or takedown
              confirmations, reply to this email or contact{" "}
              <Link href="mailto:brendan@askarthur.au" style={{ color: "#0D9488" }}>
                brendan@askarthur.au
              </Link>
              . Ask Arthur is operated in accordance with the Australian Privacy
              Act 1988 (Cth).
            </Text>
            <Text style={{ fontSize: "12px", color: "#94A3B8", margin: "12px 0 0 0" }}>
              <Link href="https://askarthur.au/privacy" style={{ color: "#94A3B8" }}>
                Privacy
              </Link>{" "}
              &middot;{" "}
              <Link href="https://askarthur.au" style={{ color: "#94A3B8" }}>
                askarthur.au
              </Link>
            </Text>
            <Text style={{ fontSize: "12px", color: "#94A3B8", lineHeight: 1.5, margin: "8px 0 0 0" }}>
              Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
            </Text>
          </Section>
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
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text style={{ fontSize: "13px", margin: "4px 0", lineHeight: 1.5 }}>
      <span style={{ color: "#64748B", display: "inline-block", width: "120px" }}>
        {label}
      </span>
      <span style={{ color: "#0F172A" }}>{value}</span>
    </Text>
  );
}

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

interface CollectiveIntelligenceProps {
  name?: string;
  unsubscribeUrl?: string;
}

export default function CollectiveIntelligence({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: CollectiveIntelligenceProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>Why isolated scam prevention isn&apos;t enough</Preview>
      <Body style={{ backgroundColor: "#F8FAFC", fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
          <Section style={{ backgroundColor: "#1B2A4A", borderRadius: "8px 8px 0 0", padding: "24px 28px" }}>
            <Text style={{ color: "#FFFFFF", fontSize: "12px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" as const, margin: 0 }}>Ask Arthur</Text>
          </Section>

          <Section style={{ backgroundColor: "#FFFFFF", borderRadius: "0 0 8px 8px", padding: "28px", border: "1px solid #E2E8F0", borderTop: "none" }}>
            <Heading as="h1" style={{ color: "#1B2A4A", fontSize: "22px", fontWeight: 700, margin: "0 0 16px 0" }}>
              Why isolated scam prevention isn&apos;t enough
            </Heading>

            {name && <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>Hi {name},</Text>}

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              ASIC&apos;s REP 761 found the Big Four banks detected only <strong>13% of scam payments</strong>. Why so low? Because scams don&apos;t respect organisational boundaries &mdash; a phishing URL that hits one bank today will hit three more tomorrow.
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Ask Arthur&apos;s Threat API turns this problem into an advantage. Every API call your organisation makes does two things simultaneously:
            </Text>

            <Text style={{ color: "#334155", fontSize: "15px", lineHeight: "2", paddingLeft: "16px" }}>
              1. <strong>Protects your customers</strong> with AI-powered scam detection<br />
              2. <strong>Strengthens the network</strong> by contributing anonymised threat intelligence
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              The result: a scam URL flagged by one organisation is immediately available to protect customers across the entire network. This is precisely the kind of cross-ecosystem collaboration the SPF Act&apos;s Disrupt principle demands.
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Six API endpoints. Real-time detection. Automated compliance evidence. Every call documented in your audit trail.
            </Text>

            <Section style={{ textAlign: "center" as const, margin: "24px 0" }}>
              <Link
                href="https://askarthur.au/api/v1/openapi.json"
                style={{ backgroundColor: "#0D9488", color: "#FFFFFF", padding: "12px 24px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}
              >
                Explore the Threat API
              </Link>
            </Section>

            <Text style={{ color: "#64748B", fontSize: "14px", marginTop: "32px" }}>&mdash; Brendan Milton, Founder, Ask Arthur</Text>
            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0" }} />
            <Text style={{ color: "#94A3B8", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>Ask Arthur | ABN 72 695 772 313 | Sydney, Australia</Text>
            <Text style={{ color: "#94A3B8", fontSize: "12px", margin: "8px 0 0 0" }}><Link href={unsubscribeUrl} style={{ color: "#94A3B8" }}>Unsubscribe</Link></Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

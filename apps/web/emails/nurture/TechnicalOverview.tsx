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

interface TechnicalOverviewProps {
  name?: string;
  unsubscribeUrl?: string;
}

export default function TechnicalOverview({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: TechnicalOverviewProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>Six API endpoints. Live in under a day.</Preview>
      <Body style={{ backgroundColor: "#F8FAFC", fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
          <Section style={{ backgroundColor: "#1B2A4A", borderRadius: "8px 8px 0 0", padding: "24px 28px" }}>
            <Text style={{ color: "#FFFFFF", fontSize: "12px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" as const, margin: 0 }}>Ask Arthur</Text>
          </Section>

          <Section style={{ backgroundColor: "#FFFFFF", borderRadius: "0 0 8px 8px", padding: "28px", border: "1px solid #E2E8F0", borderTop: "none" }}>
            <Heading as="h1" style={{ color: "#1B2A4A", fontSize: "22px", fontWeight: 700, margin: "0 0 16px 0" }}>
              Six API endpoints. Live in under a day.
            </Heading>

            {name && <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>Hi {name},</Text>}

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              This email is for the technical stakeholder in your team. Feel free to forward it to your IT or engineering lead.
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", fontWeight: 700 }}>
              The Ask Arthur Threat API:
            </Text>

            <Text style={{ color: "#334155", fontSize: "14px", lineHeight: "2", paddingLeft: "16px", fontFamily: "monospace" }}>
              GET /api/v1/entities/lookup &mdash; Entity reputation check<br />
              GET /api/v1/threats/urls/lookup &mdash; URL threat analysis<br />
              GET /api/v1/threats/domains &mdash; Domain intelligence<br />
              GET /api/v1/threats/wallets/lookup &mdash; Crypto wallet check<br />
              GET /api/v1/threats/trending &mdash; Trending threats<br />
              GET /api/v1/threats/stats &mdash; Network statistics
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", fontWeight: 700, marginTop: "16px" }}>
              Quick start:
            </Text>

            <Section style={{ backgroundColor: "#1B2A4A", borderRadius: "8px", padding: "16px", margin: "12px 0" }}>
              <Text style={{ color: "#E2E8F0", fontSize: "13px", fontFamily: "monospace", lineHeight: "1.8", margin: 0 }}>
                curl -H &quot;Authorization: Bearer YOUR_API_KEY&quot; \<br />
                &nbsp;&nbsp;https://askarthur.au/api/v1/threats/urls/lookup?url=suspicious.example.com
              </Text>
            </Section>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              <strong>Authentication:</strong> Bearer token via API key<br />
              <strong>Rate limits:</strong> 60 RPM (free), 300 RPM (enterprise)<br />
              <strong>Response time:</strong> &lt; 200ms average<br />
              <strong>Format:</strong> JSON with structured verdicts<br />
              <strong>Documentation:</strong> OpenAPI 3.0 spec with interactive explorer
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Every API call is logged in your organisation&apos;s compliance dashboard with timestamps, endpoints, and response codes &mdash; ready for regulatory audit at any time.
            </Text>

            <Section style={{ textAlign: "center" as const, margin: "24px 0" }}>
              <Link
                href="https://askarthur.au/api/v1/openapi.json"
                style={{ backgroundColor: "#0D9488", color: "#FFFFFF", padding: "12px 24px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}
              >
                View API Documentation
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

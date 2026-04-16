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

interface SPFIntroProps {
  name?: string;
  unsubscribeUrl?: string;
}

export default function SPFIntro({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: SPFIntroProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>The SPF Act is live. Is your organisation ready?</Preview>
      <Body
        style={{
          backgroundColor: "#F8FAFC",
          fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
          <Section style={{ backgroundColor: "#1B2A4A", borderRadius: "8px 8px 0 0", padding: "24px 28px" }}>
            <Text style={{ color: "#FFFFFF", fontSize: "12px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" as const, margin: 0 }}>
              Ask Arthur
            </Text>
          </Section>

          <Section style={{ backgroundColor: "#FFFFFF", borderRadius: "0 0 8px 8px", padding: "28px", border: "1px solid #E2E8F0", borderTop: "none" }}>
            <Heading as="h1" style={{ color: "#1B2A4A", fontSize: "22px", fontWeight: 700, margin: "0 0 16px 0" }}>
              The SPF Act is live. Is your organisation ready?
            </Heading>

            {name && (
              <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
                Hi {name},
              </Text>
            )}

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Australia&apos;s <strong>Scams Prevention Framework Act 2025</strong> received Royal Assent on 20 February 2025 &mdash; making it the world&apos;s first scam prevention legislation.
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Sector codes for <strong>banks, telcos, and digital platforms</strong> take effect from <strong>1 July 2026</strong>. The Act establishes six overarching principles every regulated entity must follow:
            </Text>

            <Text style={{ color: "#334155", fontSize: "15px", lineHeight: "2", paddingLeft: "16px" }}>
              1. <strong>Govern</strong> &mdash; Document policies and procedures<br />
              2. <strong>Prevent</strong> &mdash; Proactive scam prevention measures<br />
              3. <strong>Detect</strong> &mdash; Identify scam-related activity<br />
              4. <strong>Report</strong> &mdash; Share intelligence with authorities<br />
              5. <strong>Disrupt</strong> &mdash; Take action to stop scams<br />
              6. <strong>Respond</strong> &mdash; Support affected customers
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Tier 1 penalties reach <strong>AUD $52.7 million</strong> or <strong>30% of adjusted turnover</strong>, whichever is greater. AFCA will begin accepting SPF complaints from 1 January 2027.
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", marginTop: "24px" }}>
              We&apos;ve put together a comprehensive SPF compliance checklist to help you assess your readiness across all six principles.
            </Text>

            <Section style={{ textAlign: "center" as const, margin: "24px 0" }}>
              <Link
                href="https://askarthur.au/spf-assessment"
                style={{ backgroundColor: "#0D9488", color: "#FFFFFF", padding: "12px 24px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}
              >
                Check Your SPF Readiness
              </Link>
            </Section>

            <Text style={{ color: "#64748B", fontSize: "14px", marginTop: "32px" }}>
              &mdash; Brendan Milton, Founder, Ask Arthur
            </Text>

            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0" }} />
            <Text style={{ color: "#94A3B8", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
              Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: "12px", margin: "8px 0 0 0" }}>
              <Link href={unsubscribeUrl} style={{ color: "#94A3B8" }}>Unsubscribe</Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

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

interface CaseStudyProps {
  name?: string;
  unsubscribeUrl?: string;
}

export default function CaseStudy({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: CaseStudyProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>How Australian organisations are preparing for SPF compliance</Preview>
      <Body style={{ backgroundColor: "#F8FAFC", fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
          <Section style={{ backgroundColor: "#1B2A4A", borderRadius: "8px 8px 0 0", padding: "24px 28px" }}>
            <Text style={{ color: "#FFFFFF", fontSize: "12px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" as const, margin: 0 }}>Ask Arthur</Text>
          </Section>

          <Section style={{ backgroundColor: "#FFFFFF", borderRadius: "0 0 8px 8px", padding: "28px", border: "1px solid #E2E8F0", borderTop: "none" }}>
            <Heading as="h1" style={{ color: "#1B2A4A", fontSize: "22px", fontWeight: 700, margin: "0 0 16px 0" }}>
              How organisations are preparing
            </Heading>

            {name && <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>Hi {name},</Text>}

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              With the SPF sector codes approaching, here&apos;s what proactive compliance teams are doing differently:
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", fontWeight: 700 }}>
              Without automated scam intelligence:
            </Text>
            <Text style={{ color: "#334155", fontSize: "15px", lineHeight: "2", paddingLeft: "16px" }}>
              &bull; Manual review of flagged transactions (hours per case)<br />
              &bull; Ad-hoc regulatory reporting when required<br />
              &bull; No documented evidence of &quot;reasonable steps&quot;<br />
              &bull; Compliance audit preparation takes weeks
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6", fontWeight: 700 }}>
              With Ask Arthur integrated:
            </Text>
            <Text style={{ color: "#334155", fontSize: "15px", lineHeight: "2", paddingLeft: "16px" }}>
              &bull; Real-time AI detection catches threats in milliseconds<br />
              &bull; Every API call generates timestamped compliance evidence<br />
              &bull; SPF principle mapping shows exactly which obligations are met<br />
              &bull; Board-ready compliance reports generated in one click
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              The ABA&apos;s Scam-Safe Accord has already delivered a <strong>26% reduction in scam losses</strong> during its first full year. The organisations seeing the best results are those combining industry collaboration with AI-powered detection &mdash; exactly the model Ask Arthur provides.
            </Text>

            <Section style={{ textAlign: "center" as const, margin: "24px 0" }}>
              <Link
                href="https://askarthur.au/spf-assessment"
                style={{ backgroundColor: "#0D9488", color: "#FFFFFF", padding: "12px 24px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}
              >
                Book a 15-Minute Demo
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

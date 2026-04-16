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

interface ReasonableStepsProps {
  name?: string;
  unsubscribeUrl?: string;
}

export default function ReasonableSteps({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: ReasonableStepsProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>What counts as &quot;reasonable steps&quot; under the SPF Act?</Preview>
      <Body style={{ backgroundColor: "#F8FAFC", fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
          <Section style={{ backgroundColor: "#1B2A4A", borderRadius: "8px 8px 0 0", padding: "24px 28px" }}>
            <Text style={{ color: "#FFFFFF", fontSize: "12px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" as const, margin: 0 }}>Ask Arthur</Text>
          </Section>

          <Section style={{ backgroundColor: "#FFFFFF", borderRadius: "0 0 8px 8px", padding: "28px", border: "1px solid #E2E8F0", borderTop: "none" }}>
            <Heading as="h1" style={{ color: "#1B2A4A", fontSize: "22px", fontWeight: 700, margin: "0 0 16px 0" }}>
              What counts as &quot;reasonable steps&quot;?
            </Heading>

            {name && <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>Hi {name},</Text>}

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Section 58BB of the SPF Act is the provision that matters most. It establishes that whether a regulated entity has taken <strong>&quot;reasonable steps&quot;</strong> depends on entity-specific factors: size, services, consumer base, complexity, and scam exposure.
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Treasury&apos;s position paper states: <em>&quot;Reasonable steps involve businesses taking genuine, proactive and proportionate actions to reduce scam activity.&quot;</em> Larger businesses or those facing higher scam risks <em>&quot;may be expected to go beyond minimum requirements.&quot;</em>
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Here&apos;s what this means in practice:
            </Text>

            <Text style={{ color: "#334155", fontSize: "15px", lineHeight: "2", paddingLeft: "16px" }}>
              &bull; Code compliance is the <strong>primary consideration</strong>, but not sufficient alone<br />
              &bull; <strong>Additional evidence</strong> of proactive measures strengthens your defence<br />
              &bull; <strong>Documented audit trails</strong> demonstrate ongoing commitment<br />
              &bull; <strong>Cross-ecosystem intelligence sharing</strong> supports multiple principles simultaneously
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Critically, <strong>Section 58BT</strong> explicitly contemplates &quot;authorised third party data gateways&quot; &mdash; a statutory category for platforms like Ask Arthur. Contributing scam intelligence to Ask Arthur supports your Detect, Report, Disrupt, and Governance obligations simultaneously.
            </Text>

            <Section style={{ textAlign: "center" as const, margin: "24px 0" }}>
              <Link
                href="https://askarthur.au/banking"
                style={{ backgroundColor: "#0D9488", color: "#FFFFFF", padding: "12px 24px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}
              >
                See How Ask Arthur Helps
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

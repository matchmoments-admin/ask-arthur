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

interface DeadlineProps {
  name?: string;
  unsubscribeUrl?: string;
}

export default function Deadline({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: DeadlineProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>SPF sector codes take effect July 2026. Let&apos;s talk this week.</Preview>
      <Body style={{ backgroundColor: "#F8FAFC", fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
          <Section style={{ backgroundColor: "#1B2A4A", borderRadius: "8px 8px 0 0", padding: "24px 28px" }}>
            <Text style={{ color: "#FFFFFF", fontSize: "12px", fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" as const, margin: 0 }}>Ask Arthur</Text>
          </Section>

          <Section style={{ backgroundColor: "#FFFFFF", borderRadius: "0 0 8px 8px", padding: "28px", border: "1px solid #E2E8F0", borderTop: "none" }}>
            <Heading as="h1" style={{ color: "#1B2A4A", fontSize: "22px", fontWeight: 700, margin: "0 0 16px 0" }}>
              Let&apos;s talk this week
            </Heading>

            {name && <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>Hi {name},</Text>}

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Over the past few weeks, I&apos;ve shared how the SPF Act works, what &quot;reasonable steps&quot; means in practice, and how Ask Arthur&apos;s Threat API turns compliance from a burden into a competitive advantage.
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Here&apos;s where things stand:
            </Text>

            <Text style={{ color: "#334155", fontSize: "15px", lineHeight: "2", paddingLeft: "16px" }}>
              &bull; <strong>Sector codes take effect 1 July 2026</strong><br />
              &bull; <strong>AFCA accepts SPF complaints from 1 January 2027</strong><br />
              &bull; <strong>Tier 1 penalties: up to $52.7M or 30% of turnover</strong><br />
              &bull; <strong>Regulators are already enforcing</strong> &mdash; Exetel ($694K), Circles.Life ($413K)
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              I&apos;d like to offer you a <strong>complimentary SPF compliance gap assessment</strong> during a 15-minute demo. We&apos;ll review your current posture against each SPF principle and identify exactly where Ask Arthur can strengthen your evidence of &quot;reasonable steps.&quot;
            </Text>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              No sales pitch &mdash; just a practical assessment you can take straight to your compliance committee.
            </Text>

            <Section style={{ textAlign: "center" as const, margin: "24px 0" }}>
              <Link
                href="https://askarthur.au/spf-assessment"
                style={{ backgroundColor: "#0D9488", color: "#FFFFFF", padding: "12px 24px", borderRadius: "8px", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}
              >
                Book Your Demo &amp; Gap Assessment
              </Link>
            </Section>

            <Text style={{ color: "#334155", fontSize: "16px", lineHeight: "1.6" }}>
              Or reply to this email directly &mdash; it comes straight to me.
            </Text>

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

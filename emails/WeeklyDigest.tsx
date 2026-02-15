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

interface ScamItem {
  brand: string;
  summary: string;
}

interface WeeklyDigestProps {
  scams: ScamItem[];
  blogUrl?: string;
}

export default function WeeklyDigest({
  scams = [],
  blogUrl,
}: WeeklyDigestProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>This week&apos;s top scams detected by Ask Arthur</Preview>
      <Body
        style={{
          backgroundColor: "#F8FAFC",
          fontFamily:
            "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "40px 20px",
          }}
        >
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
              style={{
                color: "#FFFFFF",
                fontSize: "22px",
                fontWeight: 700,
                margin: "8px 0 0 0",
              }}
            >
              Weekly Scam Alert
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
            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
              }}
            >
              Here are the top scams we detected this week:
            </Text>

            {scams.map((scam, i) => (
              <Section key={i} style={{ marginBottom: "16px" }}>
                <Text
                  style={{
                    color: "#1B2A4A",
                    fontSize: "15px",
                    fontWeight: 600,
                    margin: "0 0 4px 0",
                  }}
                >
                  {i + 1}. {scam.brand}
                </Text>
                <Text
                  style={{
                    color: "#475569",
                    fontSize: "14px",
                    lineHeight: "1.5",
                    margin: "0 0 8px 0",
                  }}
                >
                  {scam.summary}
                </Text>
              </Section>
            ))}

            {blogUrl && (
              <>
                <Hr
                  style={{
                    borderColor: "#E2E8F0",
                    margin: "24px 0",
                  }}
                />
                <Link
                  href={blogUrl}
                  style={{
                    display: "inline-block",
                    backgroundColor: "#0D9488",
                    color: "#FFFFFF",
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "10px 20px",
                    borderRadius: "6px",
                    textDecoration: "none",
                  }}
                >
                  Read the full report
                </Link>
              </>
            )}

            <Hr
              style={{
                borderColor: "#E2E8F0",
                margin: "24px 0",
              }}
            />

            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
              }}
            >
              Got a suspicious message? Check it free at{" "}
              <Link
                href="https://askarthur.ai"
                style={{ color: "#0D9488" }}
              >
                askarthur.ai
              </Link>
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                marginTop: "24px",
              }}
            >
              You&apos;re receiving this because you subscribed to weekly scam
              alerts.{" "}
              <Link
                href="https://askarthur.ai/unsubscribe"
                style={{ color: "#94A3B8" }}
              >
                Unsubscribe
              </Link>
            </Text>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                lineHeight: "1.5",
                margin: "8px 0 0 0",
              }}
            >
              Ask Arthur | ABN [YOUR_ABN] | Sydney, Australia
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

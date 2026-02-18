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

interface WelcomeProps {
  email?: string;
}

export default function Welcome({ email = "" }: WelcomeProps) {
  const unsubscribeUrl = `https://askarthur.au/unsubscribe${email ? `?email=${encodeURIComponent(email)}` : ""}`;
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>Welcome to Ask Arthur — you&apos;re on the list!</Preview>
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
            <Heading
              as="h1"
              style={{
                color: "#1B2A4A",
                fontSize: "24px",
                fontWeight: 700,
                margin: "0 0 16px 0",
              }}
            >
              Welcome to Ask Arthur!
            </Heading>

            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
              }}
            >
              Thanks for joining the waitlist for{" "}
              <strong>Scam Shield for Families</strong>. We&apos;re building
              automatic protection to keep your loved ones safe from scams.
            </Text>

            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
              }}
            >
              In the meantime, you can use our free scam checker anytime at{" "}
              <Link
                href="https://askarthur.au"
                style={{ color: "#0D9488" }}
              >
                askarthur.au
              </Link>
              .
            </Text>

            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
              }}
            >
              You&apos;ll also receive weekly scam alerts so you can stay one
              step ahead of the latest threats targeting Australians.
            </Text>

            <Text
              style={{
                color: "#64748B",
                fontSize: "14px",
                marginTop: "32px",
              }}
            >
              — The Ask Arthur Team
            </Text>

            <Hr
              style={{
                borderColor: "#E2E8F0",
                margin: "24px 0",
              }}
            />

            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                lineHeight: "1.5",
                margin: 0,
              }}
            >
              Ask Arthur | ABN [YOUR_ABN] | Sydney, Australia
            </Text>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                margin: "8px 0 0 0",
              }}
            >
              <Link
                href={unsubscribeUrl}
                style={{ color: "#94A3B8" }}
              >
                Unsubscribe
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

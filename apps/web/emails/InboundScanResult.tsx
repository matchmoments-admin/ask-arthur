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
  Row,
  Column,
} from "@react-email/components";

import type { Verdict } from "@askarthur/types";

interface InboundScanResultProps {
  verdict: Verdict;
  confidence: number;
  summary: string;
  redFlags: string[];
  nextSteps: string[];
  forwardedSubject: string;
  displayName?: string;
  /** Signed verify-then-record URL for thumbs-up. Generated in route.ts. */
  feedbackUpUrl: string;
  /** Signed verify-then-record URL for thumbs-down. */
  feedbackDownUrl: string;
}

interface VerdictStyle {
  headline: string;
  pillBg: string;
  pillBorder: string;
  pillText: string;
  flagBar: string;
}

// Token-driven verdict palette. Mirrors the web ResultCard but flattened
// to plain hex (Gmail strips CSS variables and class names) and softened
// for the email-on-white backdrop. Aligns with the Verdict enum in
// packages/types/src/analysis.ts.
const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  SAFE: {
    headline: "Looks safe — still verify",
    pillBg: "#F0FDF4",
    pillBorder: "#86EFAC",
    pillText: "#15803D",
    flagBar: "#16A34A",
  },
  UNCERTAIN: {
    headline: "We couldn't classify this",
    pillBg: "#F8FAFC",
    pillBorder: "#CBD5E1",
    pillText: "#475569",
    flagBar: "#64748B",
  },
  SUSPICIOUS: {
    headline: "This looks suspicious",
    pillBg: "#FFFBEB",
    pillBorder: "#FCD34D",
    pillText: "#92400E",
    flagBar: "#D97706",
  },
  HIGH_RISK: {
    headline: "Very likely a scam — do not engage",
    pillBg: "#FEF2F2",
    pillBorder: "#FCA5A5",
    pillText: "#B91C1C",
    flagBar: "#DC2626",
  },
};

// Heuristic split — the web ResultCard does the same in
// apps/web/components/ResultCard.tsx (`splitFlag`). Keep this in sync if
// the prompt is ever changed to return {heading, body} natively.
function splitFlag(flag: string): { heading: string; body: string } {
  const trimmed = flag.trim();
  const match = trimmed.match(/^([^.:!?]+)[.:!?]\s+([\s\S]+)$/);
  if (match) {
    return { heading: match[1].trim(), body: match[2].trim() };
  }
  return { heading: trimmed, body: "" };
}

export default function InboundScanResult({
  verdict,
  confidence,
  summary,
  redFlags,
  nextSteps,
  forwardedSubject,
  displayName,
  feedbackUpUrl,
  feedbackDownUrl,
}: InboundScanResultProps) {
  const style = VERDICT_STYLES[verdict];
  const greetingName = displayName?.split(" ")[0];
  const truncatedSubject =
    forwardedSubject.length > 100
      ? `${forwardedSubject.slice(0, 97)}…`
      : forwardedSubject;
  const steps = nextSteps.slice(0, 5);
  const flags = redFlags.slice(0, 6).map(splitFlag);
  const confidencePct = Math.max(0, Math.min(100, Math.round(confidence * 100)));

  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>
        {`Arthur's verdict: ${style.headline.toLowerCase()}`}
      </Preview>
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
          {/* Brand header */}
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
            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
                margin: "0 0 8px 0",
              }}
            >
              {greetingName ? `Hi ${greetingName},` : "Hi,"}
            </Text>

            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
                margin: "0 0 20px 0",
              }}
            >
              Here&apos;s what Arthur found in the email you forwarded.
            </Text>

            {/* Verdict pill */}
            <Section
              style={{
                backgroundColor: style.pillBg,
                border: `2px solid ${style.pillBorder}`,
                borderRadius: "8px",
                padding: "16px 18px",
                marginBottom: "24px",
              }}
            >
              <Text
                style={{
                  color: "#64748B",
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "1.5px",
                  textTransform: "uppercase" as const,
                  margin: 0,
                }}
              >
                Verdict
              </Text>
              <Heading
                as="h1"
                style={{
                  color: style.pillText,
                  fontSize: "22px",
                  fontWeight: 700,
                  lineHeight: "1.25",
                  margin: "4px 0 6px 0",
                }}
              >
                {style.headline}
              </Heading>
              <Text
                style={{
                  color: "#64748B",
                  fontSize: "13px",
                  margin: 0,
                }}
              >
                Confidence: {confidencePct}%
              </Text>
            </Section>

            {/* Why / summary */}
            {summary && (
              <Text
                style={{
                  color: "#334155",
                  fontSize: "15px",
                  lineHeight: "1.6",
                  margin: "0 0 20px 0",
                }}
              >
                <strong style={{ color: "#1B2A4A" }}>Why: </strong>
                {summary}
              </Text>
            )}

            {/* Red flags */}
            {flags.length > 0 && (
              <>
                <Text
                  style={{
                    color: "#1B2A4A",
                    fontSize: "13px",
                    fontWeight: 700,
                    letterSpacing: "1px",
                    textTransform: "uppercase" as const,
                    margin: "0 0 12px 0",
                  }}
                >
                  Red flags
                </Text>
                {flags.map((flag, i) => (
                  <Row key={i} style={{ marginBottom: "12px" }}>
                    <Column
                      style={{
                        width: "4px",
                        backgroundColor: style.flagBar,
                        borderRadius: "2px",
                        paddingRight: "12px",
                      }}
                    />
                    <Column>
                      <Text
                        style={{
                          color: "#1B2A4A",
                          fontSize: "15px",
                          fontWeight: 700,
                          lineHeight: "1.4",
                          margin: 0,
                          paddingLeft: "12px",
                        }}
                      >
                        {flag.heading}
                      </Text>
                      {flag.body && (
                        <Text
                          style={{
                            color: "#475569",
                            fontSize: "14px",
                            lineHeight: "1.55",
                            margin: "4px 0 0 0",
                            paddingLeft: "12px",
                          }}
                        >
                          {flag.body}
                        </Text>
                      )}
                    </Column>
                  </Row>
                ))}
              </>
            )}

            {/* Next steps */}
            {steps.length > 0 && (
              <>
                <Text
                  style={{
                    color: "#1B2A4A",
                    fontSize: "13px",
                    fontWeight: 700,
                    letterSpacing: "1px",
                    textTransform: "uppercase" as const,
                    margin: "24px 0 12px 0",
                  }}
                >
                  What to do
                </Text>
                <ol
                  style={{
                    color: "#334155",
                    fontSize: "15px",
                    lineHeight: "1.7",
                    margin: 0,
                    paddingLeft: "20px",
                  }}
                >
                  {steps.map((s, i) => (
                    <li key={i} style={{ marginBottom: "4px" }}>
                      {s}
                    </li>
                  ))}
                </ol>
              </>
            )}

            <Hr
              style={{
                borderColor: "#E2E8F0",
                margin: "28px 0 20px 0",
              }}
            />

            {/* Thumbs feedback */}
            <Text
              style={{
                color: "#1B2A4A",
                fontSize: "14px",
                fontWeight: 700,
                textAlign: "center" as const,
                margin: "0 0 12px 0",
              }}
            >
              How did we do?
            </Text>
            <Row>
              <Column align="center" style={{ paddingRight: "8px" }}>
                <Link
                  href={feedbackUpUrl}
                  style={{
                    display: "inline-block",
                    backgroundColor: "#FFFFFF",
                    color: "#1B2A4A",
                    border: "1px solid #CBD5E1",
                    borderRadius: "999px",
                    padding: "10px 20px",
                    fontSize: "14px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  👍 Helpful
                </Link>
              </Column>
              <Column align="center" style={{ paddingLeft: "8px" }}>
                <Link
                  href={feedbackDownUrl}
                  style={{
                    display: "inline-block",
                    backgroundColor: "#FFFFFF",
                    color: "#1B2A4A",
                    border: "1px solid #CBD5E1",
                    borderRadius: "999px",
                    padding: "10px 20px",
                    fontSize: "14px",
                    fontWeight: 600,
                    textDecoration: "none",
                  }}
                >
                  👎 Not helpful
                </Link>
              </Column>
            </Row>

            {/* Trustpilot CTA */}
            <Section
              style={{
                marginTop: "28px",
                padding: "16px 18px",
                backgroundColor: "#F8FAFC",
                border: "1px solid #E2E8F0",
                borderRadius: "8px",
                textAlign: "center" as const,
              }}
            >
              <Text
                style={{
                  color: "#1B2A4A",
                  fontSize: "14px",
                  fontWeight: 700,
                  margin: "0 0 6px 0",
                }}
              >
                Help other Aussies find Arthur
              </Text>
              <Text
                style={{
                  color: "#475569",
                  fontSize: "13px",
                  lineHeight: "1.5",
                  margin: "0 0 10px 0",
                }}
              >
                If Arthur helped you spot this one, a quick Trustpilot review
                helps the next person find us before the scammers do.
              </Text>
              <Link
                href="https://au.trustpilot.com/evaluate/askarthur.au"
                style={{
                  color: "#0D9488",
                  fontSize: "14px",
                  fontWeight: 600,
                  textDecoration: "underline",
                }}
              >
                Leave a review →
              </Link>
            </Section>

            <Hr
              style={{
                borderColor: "#E2E8F0",
                margin: "24px 0 16px 0",
              }}
            />

            <Text
              style={{
                color: "#64748B",
                fontSize: "13px",
                lineHeight: "1.55",
                margin: "0 0 12px 0",
              }}
            >
              We scanned the subject &quot;
              <em>{truncatedSubject}</em>
              &quot;. Forward more suspicious emails to{" "}
              <Link
                href="mailto:scan@askarthur.au"
                style={{ color: "#0D9488" }}
              >
                scan@askarthur.au
              </Link>{" "}
              any time, or paste them at{" "}
              <Link href="https://askarthur.au" style={{ color: "#0D9488" }}>
                askarthur.au
              </Link>
              .
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                lineHeight: "1.5",
                margin: 0,
              }}
            >
              You received this because you forwarded an email to
              scan@askarthur.au. Reply STOP and we&apos;ll skip the verdict
              email next time.
            </Text>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                lineHeight: "1.5",
                margin: "8px 0 0 0",
              }}
            >
              Ask Arthur · ABN 72 695 772 313 · askarthur.au
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

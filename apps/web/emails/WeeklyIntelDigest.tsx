// React Email template for the Reddit-intel weekly digest.
//
// Replaces the verified_scams-only WeeklyDigest when redditIntelEmail
// flag is on. Renders the lead narrative, top brands, emerging themes,
// scam-of-the-week quote, and a copy-paste tweet draft.
//
// Design notes:
//   * Same brand colour palette as WeeklyDigest (deep-navy header, teal
//     CTAs) so subscribers don't see jarring restyling.
//   * Anti-FUD subject line: numeric specificity ("X emerging scams in
//     AU this week") beats generic urgency per the source brief.
//   * Tweet draft inside a <pre>-styled box for easy copy-paste.

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

interface EmergingTheme {
  title: string;
  narrative: string | null;
  memberCount: number;
  representativeBrands: string[];
}

interface BrandWatchEntry {
  brand: string;
  mentionCount: number;
}

interface CategoryEntry {
  label: string;
  count: number;
}

export interface WeeklyIntelDigestProps {
  weekStart: string;
  weekEnd: string;
  totalPostsClassified: number;
  leadNarrative: string;
  emergingThemes: EmergingTheme[];
  topBrands: BrandWatchEntry[];
  topCategories: CategoryEntry[];
  scamOfTheWeekQuote: { text: string; speakerRole: string } | null;
  tweetDraft: string;
  modelVersion: string;
  promptVersion: string;
}

export default function WeeklyIntelDigest({
  weekStart,
  weekEnd,
  totalPostsClassified,
  leadNarrative,
  emergingThemes = [],
  topBrands = [],
  topCategories = [],
  scamOfTheWeekQuote,
  tweetDraft,
  // Identity fields rendered only in the footer for debugging — not used
  // in any of the headline copy.
  modelVersion: _modelVersion,
  promptVersion: _promptVersion,
}: WeeklyIntelDigestProps) {
  const previewLine =
    emergingThemes[0]?.title ??
    `${totalPostsClassified} scam reports analysed this week`;

  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>{previewLine}</Preview>
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
              Ask Arthur · Scam Intelligence
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
              {weekStart} → {weekEnd}
            </Heading>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                margin: "6px 0 0 0",
              }}
            >
              {totalPostsClassified} posts classified · {emergingThemes.length} active themes
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
            {/* Lead narrative */}
            {leadNarrative.split(/\n{2,}/).map((para, i) => (
              <Text
                key={i}
                style={{
                  color: "#334155",
                  fontSize: "15px",
                  lineHeight: "1.6",
                  margin: "0 0 14px 0",
                }}
              >
                {para}
              </Text>
            ))}

            {/* Emerging themes */}
            {emergingThemes.length > 0 && (
              <>
                <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
                <Heading
                  as="h2"
                  style={{
                    color: "#1B2A4A",
                    fontSize: "14px",
                    fontWeight: 700,
                    textTransform: "uppercase" as const,
                    letterSpacing: "1.5px",
                    margin: "0 0 12px 0",
                  }}
                >
                  Emerging this week
                </Heading>
                {emergingThemes.map((t, i) => (
                  <Section key={i} style={{ marginBottom: "14px" }}>
                    <Text
                      style={{
                        color: "#1B2A4A",
                        fontSize: "15px",
                        fontWeight: 600,
                        margin: "0 0 4px 0",
                      }}
                    >
                      {i + 1}. {t.title}
                      <span
                        style={{
                          color: "#94A3B8",
                          fontWeight: 400,
                          marginLeft: "8px",
                          fontSize: "12px",
                        }}
                      >
                        ({t.memberCount} reports)
                      </span>
                    </Text>
                    {t.narrative && (
                      <Text
                        style={{
                          color: "#475569",
                          fontSize: "14px",
                          lineHeight: "1.5",
                          margin: "0",
                        }}
                      >
                        {t.narrative}
                      </Text>
                    )}
                  </Section>
                ))}
              </>
            )}

            {/* Brand watchlist */}
            {topBrands.length > 0 && (
              <>
                <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
                <Heading
                  as="h2"
                  style={{
                    color: "#1B2A4A",
                    fontSize: "14px",
                    fontWeight: 700,
                    textTransform: "uppercase" as const,
                    letterSpacing: "1.5px",
                    margin: "0 0 12px 0",
                  }}
                >
                  Brands impersonated
                </Heading>
                <Text
                  style={{
                    color: "#475569",
                    fontSize: "14px",
                    lineHeight: "1.7",
                    margin: 0,
                  }}
                >
                  {topBrands
                    .map((b) => `${b.brand} (×${b.mentionCount})`)
                    .join(" · ")}
                </Text>
              </>
            )}

            {/* Scam of the week */}
            {scamOfTheWeekQuote && (
              <>
                <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
                <Heading
                  as="h2"
                  style={{
                    color: "#1B2A4A",
                    fontSize: "14px",
                    fontWeight: 700,
                    textTransform: "uppercase" as const,
                    letterSpacing: "1.5px",
                    margin: "0 0 12px 0",
                  }}
                >
                  Scam of the week
                </Heading>
                <Section
                  style={{
                    borderLeft: "3px solid #0D9488",
                    backgroundColor: "#F0FDFA",
                    padding: "12px 16px",
                  }}
                >
                  <Text
                    style={{
                      color: "#0F766E",
                      fontSize: "15px",
                      fontStyle: "italic",
                      lineHeight: "1.5",
                      margin: 0,
                    }}
                  >
                    &ldquo;{scamOfTheWeekQuote.text}&rdquo;
                  </Text>
                  <Text
                    style={{
                      color: "#94A3B8",
                      fontSize: "11px",
                      margin: "6px 0 0 0",
                    }}
                  >
                    — {scamOfTheWeekQuote.speakerRole}
                  </Text>
                </Section>
              </>
            )}

            {/* By the numbers */}
            {topCategories.length > 0 && (
              <>
                <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
                <Heading
                  as="h2"
                  style={{
                    color: "#1B2A4A",
                    fontSize: "14px",
                    fontWeight: 700,
                    textTransform: "uppercase" as const,
                    letterSpacing: "1.5px",
                    margin: "0 0 12px 0",
                  }}
                >
                  By the numbers
                </Heading>
                <Text
                  style={{
                    color: "#475569",
                    fontSize: "14px",
                    lineHeight: "1.7",
                    margin: 0,
                  }}
                >
                  {topCategories
                    .map((c) => `${c.label.replace(/_/g, " ")} (${c.count})`)
                    .join(" · ")}
                </Text>
              </>
            )}

            {/* Tweet draft */}
            <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
            <Heading
              as="h2"
              style={{
                color: "#1B2A4A",
                fontSize: "14px",
                fontWeight: 700,
                textTransform: "uppercase" as const,
                letterSpacing: "1.5px",
                margin: "0 0 12px 0",
              }}
            >
              Copy-paste tweet
            </Heading>
            <Section
              style={{
                backgroundColor: "#F1F5F9",
                border: "1px solid #CBD5E1",
                borderRadius: "6px",
                padding: "14px 16px",
                fontFamily:
                  "'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace",
              }}
            >
              <Text
                style={{
                  color: "#0F172A",
                  fontSize: "13px",
                  lineHeight: "1.6",
                  margin: 0,
                  whiteSpace: "pre-wrap" as const,
                }}
              >
                {tweetDraft}
              </Text>
            </Section>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "11px",
                margin: "6px 0 0 0",
              }}
            >
              {tweetDraft.length}/280 characters
            </Text>

            {/* Footer */}
            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0" }} />
            <Text
              style={{
                color: "#334155",
                fontSize: "14px",
                lineHeight: "1.6",
              }}
            >
              See the full breakdown at{" "}
              <Link
                href="https://askarthur.au/app/threats"
                style={{ color: "#0D9488" }}
              >
                askarthur.au/app/threats
              </Link>
            </Text>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "11px",
                margin: "16px 0 0 0",
              }}
            >
              You&apos;re receiving this because you subscribed to weekly
              scam alerts.{" "}
              <Link
                href="https://askarthur.au/unsubscribe"
                style={{ color: "#94A3B8" }}
              >
                Unsubscribe
              </Link>
            </Text>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "11px",
                margin: "8px 0 0 0",
              }}
            >
              Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

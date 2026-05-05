// Reddit-intel weekly digest — editorial briefing template.
//
// Adapted from the AskArthurBriefing reference design (navy + white only,
// Georgia serif headings + Arial sans labels, 640px max width). Replaces
// the previous teal-accented intel template so the intel digest reads as
// part of the same Ask Arthur newsletter family rather than a one-off
// styling.
//
// Slot mapping (intel data → briefing slots):
//   emergingThemes[0].title → headline (or fallback by post count)
//   stats summary           → 3-column stats card, lifted above the lead so
//                              brands see their name in the first scroll-zone
//   topBrands               → "Brands impersonated" chip strip, sits with the
//                              stats card (was buried below the lead before)
//   leadNarrative           → first paragraph only — Sonnet's multi-paragraph
//                              output buried the signal in the email
//   emergingThemes[1..]     → numbered list, "Emerging this week"
//   scamOfTheWeekQuote      → tip callout (white card, navy border)
//   topCategories           → "By the numbers" sentence
//   tweetDraft              → monospace card with char counter

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
  Button,
  Row,
  Column,
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

// ── Brand palette (matches AskArthurBriefing) ─────────────────────────────
const NAVY = "#1B2A4A";
const NAVY_SOFT = "#B8C1D1";
const WHITE = "#FFFFFF";
const DIVIDER = "#E2E8F0";
const SURFACE_TINT = "#F8FAFC";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";
const MONO = "'SF Mono', 'Monaco', 'Roboto Mono', monospace";

function humaniseDate(iso: string): string {
  // ISO date → "1 May" — short form for the briefing date band.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long" });
}

function humaniseCategory(label: string): string {
  return label
    .split("_")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
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
  modelVersion,
  promptVersion,
}: WeeklyIntelDigestProps) {
  const headline =
    emergingThemes[0]?.title ??
    `${totalPostsClassified} scam reports analysed this week`;
  const previewLine =
    emergingThemes[0]?.narrative ??
    `${totalPostsClassified} scam reports analysed across ${emergingThemes.length} active themes`;
  // Keep only the first paragraph of the lead narrative — Sonnet tends to
  // produce 80–120 words across 2–3 paragraphs, which buries the signal in
  // the email. The structured "Emerging this week" list carries the rest.
  const introLead = leadNarrative
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .find((p) => p.length > 0) ?? "";

  return (
    <Html>
      <Head />
      <Preview>{previewLine}</Preview>
      <Body
        style={{
          backgroundColor: WHITE,
          fontFamily: SERIF,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: "640px",
            margin: "0 auto",
            padding: 0,
            width: "100%",
          }}
        >
          {/* ================= HEADER ================= */}
          <Section style={{ backgroundColor: NAVY, padding: "28px 36px" }}>
            <Row>
              <Column
                style={{
                  textAlign: "left" as const,
                  verticalAlign: "middle",
                }}
              >
                <Link
                  href="https://askarthur.au"
                  style={{ textDecoration: "none", color: WHITE }}
                >
                  <Text
                    style={{
                      margin: 0,
                      color: WHITE,
                      fontFamily: SERIF,
                      fontSize: "22px",
                      fontWeight: 700,
                      letterSpacing: "0.5px",
                      lineHeight: 1,
                    }}
                  >
                    Ask Arthur
                  </Text>
                </Link>
              </Column>
              <Column
                style={{
                  textAlign: "right" as const,
                  verticalAlign: "middle",
                }}
              >
                <Text
                  style={{
                    margin: 0,
                    color: WHITE,
                    fontFamily: SANS,
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "2px",
                    textTransform: "uppercase" as const,
                    opacity: 0.85,
                  }}
                >
                  Weekly Intel
                </Text>
              </Column>
            </Row>
          </Section>

          {/* ================= CONTENT ================= */}
          <Section
            style={{ backgroundColor: WHITE, padding: "32px 36px 36px" }}
          >
            {/* Issue meta */}
            <Text
              style={{
                margin: "0 0 12px 0",
                padding: 0,
                fontFamily: SANS,
                fontSize: "12px",
                fontWeight: 600,
                letterSpacing: "2px",
                textTransform: "uppercase" as const,
                color: NAVY,
                opacity: 0.7,
              }}
            >
              Briefing · {humaniseDate(weekStart)} – {humaniseDate(weekEnd)}
            </Text>

            {/* H1 — top emerging theme or fallback */}
            <Heading
              as="h1"
              style={{
                margin: 0,
                padding: 0,
                fontSize: "34px",
                lineHeight: "40px",
                fontFamily: SERIF,
                fontWeight: 500,
                color: NAVY,
              }}
            >
              {headline}
            </Heading>

            {/* Stats card (lifted above the intro so brands see their name
                in five seconds — best-in-class threat-intel newsletters all
                lead with scannable numbers, prose follows). */}
            <div style={{ paddingTop: "20px", paddingBottom: "20px" }}>
              <Section
                style={{
                  backgroundColor: SURFACE_TINT,
                  border: `1px solid ${DIVIDER}`,
                  borderRadius: "10px",
                  padding: "24px 20px",
                }}
              >
                <Row>
                  <Column
                    style={{ width: "33%", textAlign: "center" as const }}
                  >
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SERIF,
                        fontSize: "32px",
                        lineHeight: "36px",
                        fontWeight: 600,
                        color: NAVY,
                      }}
                    >
                      {totalPostsClassified}
                    </Text>
                    <Text
                      style={{
                        margin: "4px 0 0 0",
                        padding: 0,
                        fontFamily: SANS,
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: "1.5px",
                        textTransform: "uppercase" as const,
                        color: NAVY,
                        opacity: 0.7,
                      }}
                    >
                      Posts analysed
                    </Text>
                  </Column>
                  <Column
                    style={{ width: "34%", textAlign: "center" as const }}
                  >
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SERIF,
                        fontSize: "32px",
                        lineHeight: "36px",
                        fontWeight: 600,
                        color: NAVY,
                      }}
                    >
                      {emergingThemes.length}
                    </Text>
                    <Text
                      style={{
                        margin: "4px 0 0 0",
                        padding: 0,
                        fontFamily: SANS,
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: "1.5px",
                        textTransform: "uppercase" as const,
                        color: NAVY,
                        opacity: 0.7,
                      }}
                    >
                      Active themes
                    </Text>
                  </Column>
                  <Column
                    style={{ width: "33%", textAlign: "center" as const }}
                  >
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SERIF,
                        fontSize: "32px",
                        lineHeight: "36px",
                        fontWeight: 600,
                        color: NAVY,
                      }}
                    >
                      {topBrands.length}
                    </Text>
                    <Text
                      style={{
                        margin: "4px 0 0 0",
                        padding: 0,
                        fontFamily: SANS,
                        fontSize: "11px",
                        fontWeight: 600,
                        letterSpacing: "1.5px",
                        textTransform: "uppercase" as const,
                        color: NAVY,
                        opacity: 0.7,
                      }}
                    >
                      Brands flagged
                    </Text>
                  </Column>
                </Row>
              </Section>
            </div>

            {/* Brand chip strip — sits with the stats so brand names land in
                the first scroll-zone, not buried below the prose. */}
            {topBrands.length > 0 && (
              <Text
                style={{
                  margin: "0 0 8px 0",
                  padding: 0,
                  fontFamily: SANS,
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "2px",
                  textTransform: "uppercase" as const,
                  color: NAVY,
                  opacity: 0.7,
                }}
              >
                Brands impersonated
              </Text>
            )}
            {topBrands.length > 0 && (
              <Text
                style={{
                  margin: "0 0 24px 0",
                  padding: 0,
                  fontFamily: SERIF,
                  fontSize: "15px",
                  lineHeight: "24px",
                  color: NAVY,
                  fontWeight: 400,
                }}
              >
                {topBrands
                  .map((b) => `${b.brand} (×${b.mentionCount})`)
                  .join(" · ")}
              </Text>
            )}

            {/* Lead — single tight paragraph, not the full Sonnet-generated
                multi-paragraph narrative. */}
            {introLead.length > 0 && (
              <Text
                style={{
                  margin: 0,
                  padding: 0,
                  fontFamily: SERIF,
                  fontSize: "16px",
                  lineHeight: "26px",
                  color: NAVY,
                  fontWeight: 400,
                  paddingBottom: "28px",
                }}
              >
                {introLead}
              </Text>
            )}

            {/* Emerging themes section */}
            {emergingThemes.length > 0 && (
              <>
                <Heading
                  as="h2"
                  style={{
                    margin: 0,
                    padding: 0,
                    fontSize: "22px",
                    lineHeight: "28px",
                    fontFamily: SERIF,
                    fontWeight: 600,
                    color: NAVY,
                  }}
                >
                  Emerging this week
                </Heading>
                <div style={{ paddingTop: "16px" }}>
                  {emergingThemes.map((theme, i) => (
                    <div
                      key={i}
                      style={{
                        marginTop: i === 0 ? 0 : "20px",
                        paddingBottom:
                          i === emergingThemes.length - 1 ? 0 : "16px",
                        borderBottom:
                          i === emergingThemes.length - 1
                            ? "none"
                            : `1px solid ${DIVIDER}`,
                      }}
                    >
                      <Text
                        style={{
                          margin: 0,
                          padding: 0,
                          fontFamily: SERIF,
                          fontSize: "17px",
                          lineHeight: "24px",
                          fontWeight: 600,
                          color: NAVY,
                        }}
                      >
                        {i + 1}. {theme.title}
                      </Text>
                      {theme.narrative && (
                        <Text
                          style={{
                            margin: "6px 0 0 0",
                            padding: 0,
                            fontFamily: SERIF,
                            fontSize: "15px",
                            lineHeight: "23px",
                            color: NAVY,
                            fontWeight: 400,
                            opacity: 0.85,
                          }}
                        >
                          {theme.narrative}
                        </Text>
                      )}
                      <Text
                        style={{
                          margin: "8px 0 0 0",
                          padding: 0,
                          fontFamily: SANS,
                          fontSize: "11px",
                          fontWeight: 600,
                          letterSpacing: "1.5px",
                          textTransform: "uppercase" as const,
                          color: NAVY,
                          opacity: 0.7,
                        }}
                      >
                        {theme.memberCount}{" "}
                        {theme.memberCount === 1 ? "report" : "reports"}
                        {theme.representativeBrands.length > 0 && (
                          <>
                            {" · "}
                            {theme.representativeBrands.slice(0, 3).join(" · ")}
                          </>
                        )}
                      </Text>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Scam of the week — tip callout style */}
            {scamOfTheWeekQuote && (
              <div style={{ paddingTop: "32px" }}>
                <Section
                  style={{
                    backgroundColor: WHITE,
                    border: `1px solid ${NAVY}`,
                    borderRadius: "12px",
                    padding: "28px 28px 24px 28px",
                  }}
                >
                  <Text
                    style={{
                      margin: "0 0 10px 0",
                      padding: 0,
                      fontFamily: SANS,
                      fontSize: "11px",
                      lineHeight: "14px",
                      fontWeight: 700,
                      letterSpacing: "2px",
                      textTransform: "uppercase" as const,
                      color: NAVY,
                    }}
                  >
                    Scam of the week
                  </Text>
                  <Text
                    style={{
                      margin: "0 0 12px 0",
                      padding: 0,
                      fontFamily: SERIF,
                      fontSize: "17px",
                      lineHeight: "26px",
                      color: NAVY,
                      fontWeight: 400,
                      fontStyle: "italic" as const,
                    }}
                  >
                    &ldquo;{scamOfTheWeekQuote.text}&rdquo;
                  </Text>
                  <Text
                    style={{
                      margin: 0,
                      padding: 0,
                      fontFamily: SANS,
                      fontSize: "12px",
                      lineHeight: "16px",
                      color: NAVY,
                      fontWeight: 600,
                      opacity: 0.75,
                    }}
                  >
                    &mdash; {scamOfTheWeekQuote.speakerRole} report
                  </Text>
                </Section>
              </div>
            )}

            {/* By the numbers */}
            {topCategories.length > 0 && (
              <div style={{ paddingTop: "32px" }}>
                <Heading
                  as="h2"
                  style={{
                    margin: 0,
                    padding: 0,
                    fontSize: "22px",
                    lineHeight: "28px",
                    fontFamily: SERIF,
                    fontWeight: 600,
                    color: NAVY,
                  }}
                >
                  By the numbers
                </Heading>
                <Text
                  style={{
                    margin: "12px 0 0 0",
                    padding: 0,
                    fontFamily: SERIF,
                    fontSize: "16px",
                    lineHeight: "26px",
                    color: NAVY,
                    fontWeight: 400,
                  }}
                >
                  {topCategories
                    .map((c) => `${humaniseCategory(c.label)} (${c.count})`)
                    .join(" · ")}
                </Text>
              </div>
            )}

            {/* Tweet draft — utility callout, monochrome */}
            <div style={{ paddingTop: "32px" }}>
              <Text
                style={{
                  margin: "0 0 8px 0",
                  padding: 0,
                  fontFamily: SANS,
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "2px",
                  textTransform: "uppercase" as const,
                  color: NAVY,
                  opacity: 0.75,
                }}
              >
                Copy-paste tweet
              </Text>
              <Section
                style={{
                  backgroundColor: SURFACE_TINT,
                  border: `1px solid ${DIVIDER}`,
                  borderRadius: "8px",
                  padding: "16px 18px",
                }}
              >
                <Text
                  style={{
                    margin: 0,
                    padding: 0,
                    fontFamily: MONO,
                    fontSize: "13px",
                    lineHeight: "20px",
                    color: NAVY,
                    whiteSpace: "pre-wrap" as const,
                  }}
                >
                  {tweetDraft}
                </Text>
              </Section>
              <Text
                style={{
                  margin: "6px 0 0 0",
                  padding: 0,
                  fontFamily: SANS,
                  fontSize: "11px",
                  color: NAVY,
                  opacity: 0.6,
                }}
              >
                {tweetDraft.length}/280 characters
              </Text>
            </div>

            {/* Primary CTA */}
            <div style={{ paddingTop: "32px" }}>
              <Button
                href="https://askarthur.au/app/threats"
                style={{
                  backgroundColor: NAVY,
                  color: WHITE,
                  fontFamily: SANS,
                  fontSize: "15px",
                  fontWeight: 600,
                  lineHeight: "18px",
                  padding: "14px 26px",
                  borderRadius: "8px",
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                View full intel on Ask Arthur
              </Button>
            </div>

            {/* Sign-off */}
            <Hr style={{ borderColor: DIVIDER, margin: "36px 0 28px 0" }} />
            <Text
              style={{
                margin: 0,
                padding: 0,
                fontFamily: SERIF,
                fontSize: "15px",
                lineHeight: "24px",
                color: NAVY,
                fontWeight: 400,
              }}
            >
              Stay safe out there,
              <br />
              <strong>The Ask Arthur team</strong>
            </Text>
          </Section>

          {/* ================= FOOTER ================= */}
          <Section style={{ backgroundColor: NAVY, padding: "32px 36px" }}>
            <Text
              style={{
                margin: "0 0 6px 0",
                padding: 0,
                fontFamily: SERIF,
                fontSize: "16px",
                fontWeight: 700,
                color: WHITE,
                lineHeight: "20px",
              }}
            >
              Ask Arthur
            </Text>
            <Text
              style={{
                margin: 0,
                padding: 0,
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "18px",
                color: NAVY_SOFT,
              }}
            >
              Australia&apos;s free AI scam checker · askarthur.au
            </Text>
            <Text
              style={{
                margin: "20px 0 0 0",
                padding: 0,
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "18px",
                color: NAVY_SOFT,
              }}
            >
              Ask Arthur · ABN 72 695 772 313 · Sydney, Australia
            </Text>
            <Text
              style={{
                margin: "8px 0 0 0",
                padding: 0,
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "18px",
                color: NAVY_SOFT,
              }}
            >
              You&apos;re receiving this because you subscribed to Ask
              Arthur&apos;s weekly intel.
              <br />
              <Link
                href="https://askarthur.au/unsubscribe"
                style={{ color: NAVY_SOFT, textDecoration: "underline" }}
              >
                Unsubscribe
              </Link>
              {" · "}
              <Link
                href="https://askarthur.au"
                style={{ color: NAVY_SOFT, textDecoration: "underline" }}
              >
                askarthur.au
              </Link>
            </Text>
            {/* Operator-only debug strip — pixel-tiny so it doesn't clutter
                the consumer footer when subscribers exist. Useful for prompt
                regression triage when something looks off. */}
            <Text
              style={{
                margin: "16px 0 0 0",
                padding: 0,
                fontFamily: SANS,
                fontSize: "10px",
                lineHeight: "14px",
                color: NAVY_SOFT,
                opacity: 0.5,
              }}
            >
              {modelVersion} · {promptVersion}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

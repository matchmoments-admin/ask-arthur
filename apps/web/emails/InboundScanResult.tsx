// User-scan verdict reply — editorial briefing template.
//
// Adapted from WeeklyIntelDigest's brand language: navy header/footer,
// Georgia serif body, Arial sans uppercase labels, 640px width. Keeps the
// information shape from apps/web/components/ResultCard.tsx (verdict pill,
// red-flag list with left-bar, numbered next steps, Remember disclaimer,
// thumbs feedback) so the email matches the on-site result card.
//
// Thumbs icons are inline base64-encoded SVG (lucide thumbs-up/down) so
// they render identically in Gmail/Apple Mail/Outlook without an external
// image host. Falls back to alt text in clients that don't render SVG.

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
  Img,
  Button,
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

// ── Brand palette (matches WeeklyIntelDigest) ──────────────────────────
const NAVY = "#1B2A4A";
const NAVY_SOFT = "#B8C1D1";
const WHITE = "#FFFFFF";
const DIVIDER = "#E2E8F0";
const SURFACE_TINT = "#F8FAFC";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";

// ── Verdict palette ────────────────────────────────────────────────────
// Color is constrained to: (a) the verdict pill background tint and
// border, and (b) the left bar on red-flag cards. Text stays NAVY so the
// email reads as part of the AskArthur briefing family rather than a
// shouty alert.
interface VerdictStyle {
  headline: string;
  pillBg: string;
  pillBorder: string;
  accent: string; // icon + flag-bar color
}

const VERDICT_STYLES: Record<Verdict, VerdictStyle> = {
  SAFE: {
    headline: "Looks safe — still verify",
    pillBg: "#F0FDF4",
    pillBorder: "#86EFAC",
    accent: "#16A34A",
  },
  UNCERTAIN: {
    headline: "We couldn't classify this",
    pillBg: "#F8FAFC",
    pillBorder: "#CBD5E1",
    accent: "#64748B",
  },
  SUSPICIOUS: {
    headline: "This looks suspicious",
    pillBg: "#FFFBEB",
    pillBorder: "#FCD34D",
    accent: "#D97706",
  },
  HIGH_RISK: {
    headline: "Very likely a scam — do not engage",
    pillBg: "#FEF2F2",
    pillBorder: "#FCA5A5",
    accent: "#DC2626",
  },
};

// ── Verdict icon (inline base64 SVG, lucide-style) ─────────────────────
// Per-verdict shape so the icon reinforces severity without needing a
// hosted image. Stroke uses the verdict accent color.
function verdictIconDataUrl(verdict: Verdict, color: string): string {
  // shape paths (lucide):
  //   SAFE         → eye
  //   UNCERTAIN    → help-circle
  //   SUSPICIOUS   → triangle-alert
  //   HIGH_RISK    → circle-x
  const paths: Record<Verdict, string> = {
    SAFE: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    UNCERTAIN:
      '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    SUSPICIOUS:
      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    HIGH_RISK:
      '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[verdict]}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

// ── Thumbs icons (inline base64 SVG, lucide) ───────────────────────────
const THUMBS_UP_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxQjJBNEEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNNyAxMHYxMiIvPjxwYXRoIGQ9Ik0xNSA1Ljg4IDE0IDEwaDUuODNhMiAyIDAgMCAxIDEuOTIgMi41NmwtMi4zMyA4QTIgMiAwIDAgMSAxNy41IDIySDciLz48L3N2Zz4=";

const THUMBS_DOWN_DATA_URL =
  "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMxQjJBNEEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTcgMTRWMiIvPjxwYXRoIGQ9Ik05IDE4LjEyIDEwIDE0SDQuMTdhMiAyIDAgMCAxLTEuOTItMi41NmwyLjMzLThBMiAyIDAgMCAxIDYuNSAySDE3Ii8+PC9zdmc+";

// ── Helpers ────────────────────────────────────────────────────────────

// Heuristic split — mirrors apps/web/components/ResultCard.tsx so the
// email red-flag cards have the same heading + body shape as the web UI.
function splitFlag(flag: string): { heading: string; body: string } {
  const trimmed = flag.trim();
  const match = trimmed.match(/^([^.:!?]+)[.:!?]\s+([\s\S]+)$/);
  if (match) {
    return { heading: match[1].trim(), body: match[2].trim() };
  }
  return { heading: trimmed, body: "" };
}

function humaniseToday(): string {
  // Editorial dateline — matches the WeeklyIntelDigest "Briefing · ..." band.
  return new Date().toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// ── Template ────────────────────────────────────────────────────────────

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
  const iconUrl = verdictIconDataUrl(verdict, style.accent);

  return (
    <Html>
      <Head />
      <Preview>{`Arthur's verdict: ${style.headline.toLowerCase()}`}</Preview>
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
                  Scan Result
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
              Verdict · {humaniseToday()}
            </Text>

            {/* H1 — opening line */}
            <Heading
              as="h1"
              style={{
                margin: 0,
                padding: 0,
                fontSize: "30px",
                lineHeight: "38px",
                fontFamily: SERIF,
                fontWeight: 500,
                color: NAVY,
              }}
            >
              {greetingName
                ? `Hi ${greetingName}, here's what we found.`
                : "Here's what we found."}
            </Heading>

            {/* Dek — what we scanned */}
            <Text
              style={{
                margin: "12px 0 0 0",
                padding: 0,
                fontFamily: SERIF,
                fontSize: "16px",
                lineHeight: "24px",
                color: NAVY,
                fontWeight: 400,
                opacity: 0.85,
              }}
            >
              You forwarded an email with the subject &ldquo;
              <em>{truncatedSubject}</em>&rdquo;. Arthur&apos;s take is
              below.
            </Text>

            {/* Verdict pill — icon + headline + confidence */}
            <div style={{ paddingTop: "24px" }}>
              <Section
                style={{
                  backgroundColor: style.pillBg,
                  border: `2px solid ${style.pillBorder}`,
                  borderRadius: "12px",
                  padding: "20px 22px",
                }}
              >
                <Row>
                  <Column
                    style={{
                      width: "70px",
                      verticalAlign: "middle",
                    }}
                  >
                    <Img
                      src={iconUrl}
                      width="56"
                      height="56"
                      alt=""
                      style={{ display: "block" }}
                    />
                  </Column>
                  <Column style={{ verticalAlign: "middle" }}>
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SANS,
                        fontSize: "11px",
                        fontWeight: 700,
                        letterSpacing: "2px",
                        textTransform: "uppercase" as const,
                        color: NAVY,
                        opacity: 0.65,
                      }}
                    >
                      Verdict
                    </Text>
                    <Heading
                      as="h2"
                      style={{
                        margin: "4px 0 4px 0",
                        padding: 0,
                        fontFamily: SERIF,
                        fontSize: "22px",
                        lineHeight: "28px",
                        fontWeight: 600,
                        color: NAVY,
                      }}
                    >
                      {style.headline}
                    </Heading>
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SANS,
                        fontSize: "12px",
                        fontWeight: 600,
                        letterSpacing: "0.5px",
                        color: NAVY,
                        opacity: 0.7,
                      }}
                    >
                      Confidence {confidencePct}%
                    </Text>
                  </Column>
                </Row>
              </Section>
            </div>

            {/* Why / summary */}
            {summary && (
              <Text
                style={{
                  margin: "24px 0 0 0",
                  padding: 0,
                  fontFamily: SERIF,
                  fontSize: "16px",
                  lineHeight: "26px",
                  color: NAVY,
                  fontWeight: 400,
                }}
              >
                <strong style={{ fontWeight: 700 }}>Why: </strong>
                {summary}
              </Text>
            )}

            {/* Red flags — left-bar + heading/body cards (matches ResultCard) */}
            {flags.length > 0 && (
              <div style={{ paddingTop: "28px" }}>
                <Text
                  style={{
                    margin: "0 0 14px 0",
                    padding: 0,
                    fontFamily: SANS,
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "2px",
                    textTransform: "uppercase" as const,
                    color: NAVY,
                    opacity: 0.7,
                  }}
                >
                  Red flags
                </Text>
                {flags.map((flag, i) => (
                  <Row
                    key={i}
                    style={{
                      marginBottom: i === flags.length - 1 ? 0 : "14px",
                    }}
                  >
                    <Column
                      style={{
                        width: "4px",
                        backgroundColor: style.accent,
                        borderRadius: "2px",
                        paddingRight: "14px",
                      }}
                    />
                    <Column>
                      <Text
                        style={{
                          margin: 0,
                          padding: "0 0 0 14px",
                          fontFamily: SERIF,
                          fontSize: "16px",
                          lineHeight: "24px",
                          fontWeight: 700,
                          color: NAVY,
                        }}
                      >
                        {flag.heading}
                      </Text>
                      {flag.body && (
                        <Text
                          style={{
                            margin: "4px 0 0 0",
                            padding: "0 0 0 14px",
                            fontFamily: SERIF,
                            fontSize: "15px",
                            lineHeight: "24px",
                            fontWeight: 400,
                            color: NAVY,
                            opacity: 0.85,
                          }}
                        >
                          {flag.body}
                        </Text>
                      )}
                    </Column>
                  </Row>
                ))}
              </div>
            )}

            {/* Next steps — numbered editorial list */}
            {steps.length > 0 && (
              <div style={{ paddingTop: "28px" }}>
                <Text
                  style={{
                    margin: "0 0 14px 0",
                    padding: 0,
                    fontFamily: SANS,
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "2px",
                    textTransform: "uppercase" as const,
                    color: NAVY,
                    opacity: 0.7,
                  }}
                >
                  What to do
                </Text>
                <ol
                  style={{
                    margin: 0,
                    padding: "0 0 0 22px",
                    fontFamily: SERIF,
                    fontSize: "16px",
                    lineHeight: "28px",
                    color: NAVY,
                  }}
                >
                  {steps.map((s, i) => (
                    <li key={i} style={{ marginBottom: "4px" }}>
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <Hr style={{ borderColor: DIVIDER, margin: "32px 0 20px 0" }} />

            {/* Remember disclaimer — matches ResultCard's Remember block */}
            <Text
              style={{
                margin: 0,
                padding: 0,
                fontFamily: SERIF,
                fontSize: "15px",
                lineHeight: "24px",
                color: NAVY,
                fontWeight: 400,
                opacity: 0.9,
              }}
            >
              <strong style={{ fontWeight: 700 }}>Remember: </strong>
              Arthur is a free resource to be used alongside your own
              research and best judgment. Always verify information through
              official channels and use caution when clicking links.
            </Text>

            <Hr style={{ borderColor: DIVIDER, margin: "20px 0 28px 0" }} />

            {/* How did we do? — thumbs feedback (lucide outline SVG) */}
            <Text
              style={{
                margin: "0 0 14px 0",
                padding: 0,
                fontFamily: SERIF,
                fontSize: "16px",
                fontWeight: 600,
                textAlign: "center" as const,
                color: NAVY,
              }}
            >
              How did we do?
            </Text>
            <Row>
              <Column align="center" style={{ paddingRight: "10px" }}>
                <Link
                  href={feedbackUpUrl}
                  style={{
                    display: "inline-block",
                    border: `1.5px solid ${DIVIDER}`,
                    borderRadius: "999px",
                    width: "56px",
                    height: "56px",
                    lineHeight: "56px",
                    textAlign: "center" as const,
                    textDecoration: "none",
                    backgroundColor: WHITE,
                  }}
                >
                  <Img
                    src={THUMBS_UP_DATA_URL}
                    width="22"
                    height="22"
                    alt="Helpful"
                    style={{
                      display: "inline-block",
                      verticalAlign: "middle",
                    }}
                  />
                </Link>
              </Column>
              <Column align="center" style={{ paddingLeft: "10px" }}>
                <Link
                  href={feedbackDownUrl}
                  style={{
                    display: "inline-block",
                    border: `1.5px solid ${DIVIDER}`,
                    borderRadius: "999px",
                    width: "56px",
                    height: "56px",
                    lineHeight: "56px",
                    textAlign: "center" as const,
                    textDecoration: "none",
                    backgroundColor: WHITE,
                  }}
                >
                  <Img
                    src={THUMBS_DOWN_DATA_URL}
                    width="22"
                    height="22"
                    alt="Not helpful"
                    style={{
                      display: "inline-block",
                      verticalAlign: "middle",
                    }}
                  />
                </Link>
              </Column>
            </Row>

            {/* Trustpilot CTA — editorial card */}
            <div style={{ paddingTop: "32px" }}>
              <Section
                style={{
                  backgroundColor: SURFACE_TINT,
                  border: `1px solid ${DIVIDER}`,
                  borderRadius: "10px",
                  padding: "20px 22px",
                  textAlign: "center" as const,
                }}
              >
                <Text
                  style={{
                    margin: "0 0 6px 0",
                    padding: 0,
                    fontFamily: SERIF,
                    fontSize: "17px",
                    fontWeight: 600,
                    color: NAVY,
                  }}
                >
                  Help other Aussies find Arthur
                </Text>
                <Text
                  style={{
                    margin: "0 0 14px 0",
                    padding: 0,
                    fontFamily: SERIF,
                    fontSize: "15px",
                    lineHeight: "23px",
                    color: NAVY,
                    fontWeight: 400,
                    opacity: 0.85,
                  }}
                >
                  If Arthur helped you spot this one, a quick Trustpilot
                  review helps the next person find us before the scammers
                  do.
                </Text>
                <Button
                  href="https://au.trustpilot.com/evaluate/askarthur.au"
                  style={{
                    backgroundColor: NAVY,
                    color: WHITE,
                    fontFamily: SANS,
                    fontSize: "14px",
                    fontWeight: 600,
                    lineHeight: "18px",
                    padding: "12px 24px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  Leave a review →
                </Button>
              </Section>
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
              You received this because you forwarded an email to
              scan@askarthur.au. Forward more suspicious emails any time, or
              paste them at{" "}
              <Link
                href="https://askarthur.au"
                style={{ color: NAVY_SOFT, textDecoration: "underline" }}
              >
                askarthur.au
              </Link>
              . Reply STOP if you&apos;d rather we skip the verdict email
              next time.
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
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

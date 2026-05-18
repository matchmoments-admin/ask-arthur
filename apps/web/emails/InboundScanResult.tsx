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
// Per-verdict icon — pre-rendered PNG at 2× density (112×112, displayed
// at 56×56). PNG not SVG because Gmail (and most webmail clients) strip
// `data:image/svg+xml;...` images — the broken-image placeholder is the
// first thing the user sees if we ship SVG. PNG renders identically in
// Gmail, Apple Mail, Outlook, Yahoo, ProtonMail. ~2–3 KB each.
//
// Sources: lucide eye / help-circle / triangle-alert / circle-x with
// stroke matching VERDICT_STYLES[verdict].accent. Regenerated via
// `node generate-email-icons.mjs` if the palette ever changes.
const VERDICT_ICON_PNGS: Record<Verdict, string> = {
  SAFE: "data:image/png;base64,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",
  UNCERTAIN: "data:image/png;base64,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",
  SUSPICIOUS: "data:image/png;base64,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",
  HIGH_RISK: "data:image/png;base64,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",
};

// ── Thumbs icons (inline base64 PNG, lucide) ───────────────────────────
// 2× density (80×80) displayed at 40×40, stroke NAVY. PNG for the same
// Gmail/webmail reason as the verdict icons above.
const THUMBS_UP_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAMAAAC5zwKfAAABd1BMVEVMaXEaKEobKUozMzMbKUobKkkaKUkbKkkbKkkbKkodLEkeLUsVKj8AAAAbKkkbKkkZKUsAAH8AAFUbKUobKUkcHFUbKkobKkkfL08aKkobKUkaKUkeKEcdJ04aKUoaKkobKUobKkoXJ0caKUoaKUoTJ04bKkoaKUkaKkoaKkoaKUofHz8bKkkZKkgaKkkbKkoaKUsaKUkbKkoaKkkaKkoaK0gbKkkaKUkZLEwbKkkbKkkbK0sAPz8bKUkbKUobKUocKEsqKlUZKEkaKUkaKkoeK0oaKkobKUgaKkkbKUoZKEsZKEwaKUoZJkgbKUoaKkkaKUkaKUkbKkkaKUobKUobKUkaKkkbKkkbKUoZKUoZJkwbK0oaKUkcKkoaKkoZKkoaKUodK0gaKkkbKkkaKUkXJk0bKUobKUoaKkkcKkYYKkgbKkgaKUkiIkQaKUobKkkbKkoaKUoaKkkZM0wbKksbKkkaKkkaKUoaKUoaKkobKUoaKkobKkoClr32AAAAfHRSTlMAap4F6fJXqqn+NCIMAf38PQID1eEJid4QoaatGRrctfuWIKXLDfG+kPisCLA8YWdEh3H21E3O3SjsnEAEgbmUUQZFaMddYErkgjMydDyya4jHxnxcgKOL82MUUrhtfln6I9qK0CE39HMSKlS3D3tlqIaiCmbwwau9wOLmicd1iwAAAAlwSFlzAAALEwAACxMBAJqcGAAAAc9JREFUeNrt2FVzwkAUBeClWCnaoqVQoEKRuru7u7u7e/PjW/bylJZI5zzmPO6c+82S2dkwYUyLFi1atPwrplTKhPR8wk98OK/MkQEdZTCwTuBpgYHlBBbAwE/urXejPCttcBu2wVECb2FgHoEuGFjKvWQa5YVogx+wDe4ROAEDYwTWw8Bm7kVt6ieH/NHXyV+rmxbhr5y5S0xeaU+X6RlPxMv9Qs4YpK+0Nl5qEC+vCRJZLZIA+R0l3IuXi6VAIc+eG6RGvnh5RxIUNlSD6WFJ0HCjFmTeuaD5dyLxrKhTDeZIYJYGrlEgsxn4gBEGskea0MPA7IGqhIF0TxpgP7mdBqpg4DkN7MLAd7m3tUrQlqRHWIgCt7K3A0OBndS/QoH2cV7fD6DAKblDoxZcovo0DFyk+iUKvHDytoehwGVq98HAILXHUGBRBy83PaHAGipHGAp8kHtBqQWPqWxFgWH6A+VmKPCZukcwsJq6XShwwMircT0KHKTqG0OBCarWwsBD3rSEUeABNSsYCmykZg8KrPRT8xQD6l0VVPwqVAYqzjzDgsYQGNQxLBhTcFxflHPOFbsCcMSikLP0KvzgMrPgaS0xy6Q8cWfVvgUyxr4BkH/kfytfLCwAAAAASUVORK5CYII=";

const THUMBS_DOWN_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAFAAAABQCAMAAAC5zwKfAAABm1BMVEVMaXEaKUobKkkAAAAaKUoXJk0bKkkbKkkbKkkbKkoAPz8aKUkAAH8cKEsZK0kkJEgbKksbKkkZJkwbKkocHFUfHz8bKUobKUoXLkUaKUkaKkobKkkaKkoaKkkaKUobKUofL08bKkkaKUobKkoaKUkXJ0cbKUoaKkkZKkkbKUsbKkoTJ04aKkobKUobLUgaKUkaKUsbKUkcJUsaKkkbKkoiIkQaKUkfKkobKkkaKkobKUoaKUoeK0oaKkocKUocKksaKUgbKUkqKlUbKUkAAFUaKEobKkobKkkbKUkbKUobKUkbKUodKUcaKUgbKkkbKUkaKUkbK0obKkobKkoaKkobKEoaKksbKUoaKkoaKkobKUkaKkkaKUoaKUobKkkcK0gaKkkVKj8bKUkaKUkcKkgaKUkbKkkaK0gaKUodLEkdK0gbKUkaKUkaKUkdJ04zMzMaKEsbKkkbKkkaKUoSJEgbKkobKkkZLEwbKUkZKEkaKUocKEkbKkoZKEsaKkkbKkocKkoaKkoaKUobKUoZJkgbKUoaKUoaKUkbKkrKd2SfAAAAiHRSTlMApYsBrCH9qqn+BOcCUTsHVfIUiQkI6fQLV7aVocHbuRD8+me/IPNrbCXfDffVHK1Ezxtyrw/HGM7mgnVd8D42MaYG1gNqcYPhboGzK2LMxclB8Z2bS1/7hX+foprcZTXTDKBoW4frTXs0I/Xd+RoFWLveVg688CjoRe1k2TOPqG3H4548N3ySu8tS9QAAAAlwSFlzAAALEwAACxMBAJqcGAAAAdZJREFUeNrt2EVzwzAUBGC1SQopt0khZWZmZmZmZmZm9s/uROtT03Hszh79jtbONzJIliSEWULspX/7+Hup4pqeqg99XPNpoKKvAht0cJa6VEV3XekAFxQj5d3rVbhgWRYZ9FW4YHAQciOhdi/JAH3gJ2JJsV5vRSfYh1iXYIFDiOWywGoMkQfBAgeReqKBVqRKWOBxowzFhLHAUYQqBAtUh8kSDWzHJFfEAm3IlAoWmI3MDA10IRPKAh37MnJnZ4GTiPgIFhiPyAYNzJOJ1EgWOIDEsGCB9Ujs0MAMJFpY4EWaDNRaWGA4AhOCBc4hEMIC1R/yYT4LXEb7pWCBs2gvp4HqR3NNA7dk86JggSloXqOBbWhOoIEC68ybVRqYjPb+FBaYo65Ix1x/bElasx2GwcpozZXvq9PwWL7XXku/GAYt75qgx/t/lpf9NJ5yx7wW6Ps7vikvH2i+uHON5+gxrdki3Jc7tT8FZ7i1MObvXaLnv/Axcfps3fhGNxZ/hhXazvkWPYyngd0AT2hgIsAjlhdWgK0arYNN6OA4DfwCOEUD1VnNxvLscjgob7QO7hpa1OqobYDpNDDTT85Rmbwzqyg3GMU8BYuzWuPMs0CzzDLLrP/VDywMFRSAtfR8AAAAAElFTkSuQmCC";

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
  const iconUrl = VERDICT_ICON_PNGS[verdict];

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

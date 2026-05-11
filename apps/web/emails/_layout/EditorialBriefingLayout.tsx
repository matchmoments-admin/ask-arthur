// Editorial Briefing layout — shared chrome for Ask Arthur outbound emails.
//
// Wraps every per-template body in a consistent navy header / white card /
// navy footer with rounded corners on a tinted page background. The
// template provides only the in-card content (eyebrow, H1, dek, sections);
// header label, footer copy, and unsubscribe wiring come from props.
//
// Why this lives in one place: before extraction, the navy header bar and
// footer block were duplicated across WeeklyIntelDigest plus 6 nurture
// templates with subtle drift (560px vs 640px width, Public Sans vs
// Georgia, rounded vs square corners). Centralising the chrome makes the
// brand refresh propagate, and keeps new templates a content-only file.

import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Text,
  Link,
  Row,
  Column,
} from "@react-email/components";
import type { ReactNode } from "react";
import {
  CARD_RADIUS,
  CONTAINER_MAX_WIDTH,
  DIVIDER,
  NAVY,
  NAVY_SOFT,
  SANS,
  SERIF,
  SURFACE_TINT,
  WHITE,
} from "./tokens";

export interface EditorialBriefingLayoutProps {
  /** <Preview> string — the snippet shown in the inbox list under the subject. */
  preview: string;
  /** Right-side uppercase pill in the header (e.g. "Weekly Intel", "SPF Compliance"). */
  headerLabel: string;
  /** Per-recipient unsubscribe URL — must be tokenised by the caller. */
  unsubscribeUrl: string;
  /**
   * Footer line explaining why the recipient got this email.
   * Defaults to a generic Ask Arthur subscription line.
   */
  subscriptionReason?: string;
  /**
   * Operator-only debug strip in the footer (model + prompt version).
   * Pixel-tiny, opacity 0.5 — useful for prompt regression triage.
   */
  debugStripe?: string;
  /** In-card body content rendered between header and footer. */
  children: ReactNode;
}

const DEFAULT_SUBSCRIPTION_REASON =
  "You're receiving this because you subscribed to Ask Arthur.";

export default function EditorialBriefingLayout({
  preview,
  headerLabel,
  unsubscribeUrl,
  subscriptionReason = DEFAULT_SUBSCRIPTION_REASON,
  debugStripe,
  children,
}: EditorialBriefingLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          backgroundColor: SURFACE_TINT,
          fontFamily: SERIF,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: CONTAINER_MAX_WIDTH,
            margin: "0 auto",
            padding: "32px 20px",
            width: "100%",
          }}
        >
          {/* ================= HEADER ================= */}
          <Section
            style={{
              backgroundColor: NAVY,
              padding: "28px 36px",
              borderRadius: `${CARD_RADIUS} ${CARD_RADIUS} 0 0`,
            }}
          >
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
                  {headerLabel}
                </Text>
              </Column>
            </Row>
          </Section>

          {/* ================= CONTENT ================= */}
          <Section
            style={{
              backgroundColor: WHITE,
              padding: "32px 36px 36px",
              borderLeft: `1px solid ${DIVIDER}`,
              borderRight: `1px solid ${DIVIDER}`,
            }}
          >
            {children}
          </Section>

          {/* ================= FOOTER ================= */}
          <Section
            style={{
              backgroundColor: NAVY,
              padding: "32px 36px",
              borderRadius: `0 0 ${CARD_RADIUS} ${CARD_RADIUS}`,
            }}
          >
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
              {subscriptionReason}
              <br />
              <Link
                href={unsubscribeUrl}
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
            {debugStripe && (
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
                {debugStripe}
              </Text>
            )}
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

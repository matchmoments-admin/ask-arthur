// Nurture step 1 (Day 0) — SPF Act intro brief.
//
// Refactored 2026-05-11 onto EditorialBriefingLayout: the previous
// stacked-paragraph layout was inconsistent with the Reddit Intel
// weekly briefing readers also receive, and the long opening
// paragraphs buried the two facts that matter most (the penalty
// ceiling and the sector-code start date). Both now lead in a
// 2-tile stats card before any prose.

import {
  Section,
  Text,
  Link,
  Heading,
  Row,
  Column,
} from "@react-email/components";
import EditorialBriefingLayout from "../_layout/EditorialBriefingLayout";
import { DIVIDER, NAVY, SANS, SERIF, SURFACE_TINT } from "../_layout/tokens";

interface SPFIntroProps {
  name?: string;
  unsubscribeUrl?: string;
}

const PRINCIPLES: ReadonlyArray<{ name: string; gloss: string }> = [
  { name: "Govern", gloss: "Document policies and procedures" },
  { name: "Prevent", gloss: "Proactive scam prevention measures" },
  { name: "Detect", gloss: "Identify scam-related activity" },
  { name: "Report", gloss: "Share intelligence with authorities" },
  { name: "Disrupt", gloss: "Take action to stop scams" },
  { name: "Respond", gloss: "Support affected customers" },
];

export default function SPFIntro({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: SPFIntroProps) {
  return (
    <EditorialBriefingLayout
      preview="The SPF Act is live — penalty ceiling AUD $52.7M; sector codes start 1 July 2026."
      headerLabel="SPF Compliance"
      unsubscribeUrl={unsubscribeUrl}
      subscriptionReason="You're receiving this because you registered interest in Ask Arthur's SPF compliance briefings."
    >
      {/* Eyebrow */}
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
        SPF Compliance · Brief 1 of 6
      </Text>

      {/* H1 */}
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
        The SPF Act is live. Is your organisation ready?
      </Heading>

      {/* Dek — one tight line replacing the prior 2-paragraph lead */}
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
        Australia&apos;s Scams Prevention Framework Act 2025 is the world&apos;s
        first scam prevention legislation. Sector codes for banks, telcos and
        digital platforms take effect 1 July 2026.
      </Text>

      {/* 2-tile stats card — penalty + deadline */}
      <div style={{ paddingTop: "24px", paddingBottom: "8px" }}>
        <Section
          style={{
            backgroundColor: SURFACE_TINT,
            border: `1px solid ${DIVIDER}`,
            borderRadius: "10px",
            padding: "24px 20px",
          }}
        >
          <Row>
            <Column style={{ width: "50%", textAlign: "center" as const }}>
              <Text
                style={{
                  margin: 0,
                  padding: 0,
                  fontFamily: SERIF,
                  fontSize: "28px",
                  lineHeight: "32px",
                  fontWeight: 600,
                  color: NAVY,
                }}
              >
                AUD $52.7M
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
                Tier 1 penalty ceiling
              </Text>
            </Column>
            <Column style={{ width: "50%", textAlign: "center" as const }}>
              <Text
                style={{
                  margin: 0,
                  padding: 0,
                  fontFamily: SERIF,
                  fontSize: "28px",
                  lineHeight: "32px",
                  fontWeight: 600,
                  color: NAVY,
                }}
              >
                1 Jul 2026
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
                Sector codes start
              </Text>
            </Column>
          </Row>
        </Section>
      </div>

      {/* Optional personalised greeting — kept low-key under the dek */}
      {name && (
        <Text
          style={{
            margin: "24px 0 0 0",
            padding: 0,
            fontFamily: SERIF,
            fontSize: "16px",
            lineHeight: "24px",
            color: NAVY,
          }}
        >
          Hi {name},
        </Text>
      )}

      {/* Six principles — styled like the "Emerging this week" rows so the
          briefing's typographic rhythm carries through. */}
      <div style={{ paddingTop: "24px" }}>
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
          The six overarching principles
        </Heading>
        <div style={{ paddingTop: "12px" }}>
          {PRINCIPLES.map((p, i) => (
            <div
              key={p.name}
              style={{
                marginTop: i === 0 ? 0 : "10px",
                paddingBottom: i === PRINCIPLES.length - 1 ? 0 : "10px",
                borderBottom:
                  i === PRINCIPLES.length - 1
                    ? "none"
                    : `1px solid ${DIVIDER}`,
              }}
            >
              <Text
                style={{
                  margin: 0,
                  padding: 0,
                  fontFamily: SERIF,
                  fontSize: "16px",
                  lineHeight: "22px",
                  color: NAVY,
                }}
              >
                <strong>
                  {i + 1}. {p.name}
                </strong>{" "}
                — {p.gloss}
              </Text>
            </div>
          ))}
        </div>
      </div>

      {/* Closing context */}
      <Text
        style={{
          margin: "24px 0 0 0",
          padding: 0,
          fontFamily: SERIF,
          fontSize: "16px",
          lineHeight: "26px",
          color: NAVY,
        }}
      >
        AFCA will begin accepting SPF complaints from 1 January 2027. We&apos;ve
        put together a comprehensive readiness checklist that maps each of
        your existing controls to the six principles above.
      </Text>

      {/* Primary CTA — briefing-style navy button (was teal in prior draft) */}
      <div style={{ paddingTop: "24px" }}>
        <Link
          href="https://askarthur.au/spf-assessment"
          style={{
            backgroundColor: NAVY,
            color: "#FFFFFF",
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
          Check Your SPF Readiness
        </Link>
      </div>

      {/* Sign-off */}
      <Text
        style={{
          margin: "32px 0 0 0",
          padding: 0,
          fontFamily: SERIF,
          fontSize: "15px",
          lineHeight: "24px",
          color: NAVY,
        }}
      >
        — Brendan Milton
        <br />
        <strong>Founder, Ask Arthur</strong>
      </Text>
    </EditorialBriefingLayout>
  );
}

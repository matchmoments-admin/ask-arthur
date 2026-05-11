// Nurture step 6 (Day 25) — closer with deadline + gap-assessment offer.
//
// Refactored 2026-05-11 onto EditorialBriefingLayout. The four
// pressure points lead in a stats grid so the deadline lands
// before any prose.

import { Section, Text, Link, Heading, Row, Column } from "@react-email/components";
import EditorialBriefingLayout from "../_layout/EditorialBriefingLayout";
import { DIVIDER, NAVY, SANS, SERIF, SURFACE_TINT } from "../_layout/tokens";

interface DeadlineProps {
  name?: string;
  unsubscribeUrl?: string;
}

interface Tile {
  value: string;
  label: string;
}

const TILES: ReadonlyArray<Tile> = [
  { value: "1 Jul 2026", label: "Sector codes start" },
  { value: "1 Jan 2027", label: "AFCA accepts SPF complaints" },
];

const ENFORCEMENT: ReadonlyArray<{ name: string; amount: string }> = [
  { name: "Exetel", amount: "$694K" },
  { name: "Circles.Life", amount: "$413K" },
];

export default function Deadline({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: DeadlineProps) {
  return (
    <EditorialBriefingLayout
      preview="Sector codes start 1 July 2026 — let's run a free SPF gap assessment this week."
      headerLabel="SPF Compliance"
      unsubscribeUrl={unsubscribeUrl}
      subscriptionReason="You're receiving this because you registered interest in Ask Arthur's SPF compliance briefings."
    >
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
        SPF Compliance · Brief 6 of 6
      </Text>

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
        Let&apos;s talk this week
      </Heading>

      <Text
        style={{
          margin: "12px 0 0 0",
          padding: 0,
          fontFamily: SERIF,
          fontSize: "16px",
          lineHeight: "24px",
          color: NAVY,
          opacity: 0.85,
        }}
      >
        Tier 1 penalties reach AUD $52.7M or 30% of turnover. Regulators are
        already enforcing — and the sector-code clock has started.
      </Text>

      {/* Two-tile date stats card */}
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
            {TILES.map((t, i) => (
              <Column
                key={t.label}
                style={{
                  width: "50%",
                  textAlign: "center" as const,
                  borderRight:
                    i === 0 ? `1px solid ${DIVIDER}` : "none",
                }}
              >
                <Text
                  style={{
                    margin: 0,
                    padding: 0,
                    fontFamily: SERIF,
                    fontSize: "26px",
                    lineHeight: "30px",
                    fontWeight: 600,
                    color: NAVY,
                  }}
                >
                  {t.value}
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
                  {t.label}
                </Text>
              </Column>
            ))}
          </Row>
        </Section>
      </div>

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
        Over the past few briefs we&apos;ve covered how the SPF Act works,
        what &ldquo;reasonable steps&rdquo; means in practice, and how Ask
        Arthur&apos;s Threat API turns compliance evidence into a by-product
        of normal operation.
      </Text>

      {/* Recent enforcement examples */}
      <div style={{ paddingTop: "20px" }}>
        <Text
          style={{
            margin: "0 0 8px 0",
            padding: 0,
            fontFamily: SANS,
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "1.5px",
            textTransform: "uppercase" as const,
            color: NAVY,
            opacity: 0.75,
          }}
        >
          Recent telco enforcement
        </Text>
        <Text
          style={{
            margin: 0,
            padding: 0,
            fontFamily: SERIF,
            fontSize: "16px",
            lineHeight: "26px",
            color: NAVY,
          }}
        >
          {ENFORCEMENT.map((e, i) => (
            <span key={e.name}>
              {i > 0 && " · "}
              <strong>{e.name}</strong> ({e.amount})
            </span>
          ))}
        </Text>
      </div>

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
        I&apos;d like to offer you a <strong>complimentary SPF compliance
        gap assessment</strong> in a 15-minute demo. We&apos;ll review your
        current posture against each SPF principle and identify exactly
        where Ask Arthur can strengthen your evidence of &ldquo;reasonable
        steps.&rdquo; No sales pitch — just an assessment you can take
        straight to your compliance committee.
      </Text>

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
          Book Your Demo &amp; Gap Assessment
        </Link>
      </div>

      <Text
        style={{
          margin: "16px 0 0 0",
          padding: 0,
          fontFamily: SERIF,
          fontSize: "16px",
          lineHeight: "24px",
          color: NAVY,
        }}
      >
        Or just reply to this email — it comes straight to me.
      </Text>

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

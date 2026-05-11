// Nurture step 4 (Day 12) — case study / before-and-after.
//
// Refactored 2026-05-11 onto EditorialBriefingLayout. The two
// before/after lists become side-by-side narrative blocks that
// share the briefing's typographic rhythm.

import { Section, Text, Link, Heading } from "@react-email/components";
import EditorialBriefingLayout from "../_layout/EditorialBriefingLayout";
import { DIVIDER, NAVY, SANS, SERIF, SURFACE_TINT } from "../_layout/tokens";

interface CaseStudyProps {
  name?: string;
  unsubscribeUrl?: string;
}

const WITHOUT: ReadonlyArray<string> = [
  "Manual review of flagged transactions takes hours per case",
  "Ad-hoc regulatory reporting only when required",
  "No documented evidence of “reasonable steps”",
  "Compliance audit preparation takes weeks",
];

const WITH: ReadonlyArray<string> = [
  "Real-time AI detection catches threats in milliseconds",
  "Every API call generates timestamped compliance evidence",
  "SPF principle mapping shows which obligations are met",
  "Board-ready compliance reports generated in one click",
];

function ChecklistBlock({
  title,
  items,
}: {
  title: string;
  items: ReadonlyArray<string>;
}) {
  return (
    <Section
      style={{
        backgroundColor: SURFACE_TINT,
        border: `1px solid ${DIVIDER}`,
        borderRadius: "10px",
        padding: "20px 22px",
      }}
    >
      <Text
        style={{
          margin: "0 0 12px 0",
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
        {title}
      </Text>
      {items.map((item, i) => (
        <Text
          key={`${title}-${i}`}
          style={{
            margin: i === 0 ? 0 : "8px 0 0 0",
            padding: 0,
            fontFamily: SERIF,
            fontSize: "15px",
            lineHeight: "22px",
            color: NAVY,
          }}
        >
          · {item}
        </Text>
      ))}
    </Section>
  );
}

export default function CaseStudy({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: CaseStudyProps) {
  return (
    <EditorialBriefingLayout
      preview="How Australian organisations are preparing for SPF compliance — before and after Ask Arthur."
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
        SPF Compliance · Brief 4 of 6
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
        How organisations are preparing
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
        With sector codes approaching, the proactive compliance teams are
        moving from manual review to evidenced, automated detection.
      </Text>

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

      <div style={{ paddingTop: "24px" }}>
        <ChecklistBlock title="Without automated scam intelligence" items={WITHOUT} />
      </div>

      <div style={{ paddingTop: "16px" }}>
        <ChecklistBlock title="With Ask Arthur integrated" items={WITH} />
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
        The ABA&apos;s Scam-Safe Accord has already delivered a{" "}
        <strong>26% reduction in scam losses</strong> in its first full year.
        The organisations seeing the best results are combining industry
        collaboration with AI-powered detection — exactly the model Ask
        Arthur provides.
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
          Book a 15-Minute Demo
        </Link>
      </div>

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

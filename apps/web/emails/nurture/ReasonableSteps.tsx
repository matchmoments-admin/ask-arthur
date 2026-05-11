// Nurture step 2 (Day 3) — Section 58BB / "reasonable steps".
//
// Refactored 2026-05-11 onto EditorialBriefingLayout.

import { Text, Link, Heading } from "@react-email/components";
import EditorialBriefingLayout from "../_layout/EditorialBriefingLayout";
import { DIVIDER, NAVY, SANS, SERIF } from "../_layout/tokens";

interface ReasonableStepsProps {
  name?: string;
  unsubscribeUrl?: string;
}

const POINTS: ReadonlyArray<{ lead: string; rest: string }> = [
  {
    lead: "Code compliance is primary",
    rest: "but not sufficient on its own.",
  },
  {
    lead: "Additional proactive evidence",
    rest: "strengthens your defence under audit.",
  },
  {
    lead: "Documented audit trails",
    rest: "demonstrate ongoing commitment over time.",
  },
  {
    lead: "Cross-ecosystem intelligence sharing",
    rest: "supports multiple SPF principles simultaneously.",
  },
];

export default function ReasonableSteps({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: ReasonableStepsProps) {
  return (
    <EditorialBriefingLayout
      preview={`What counts as "reasonable steps" under the SPF Act — Section 58BB explained.`}
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
        SPF Compliance · Brief 2 of 6
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
        What counts as &ldquo;reasonable steps&rdquo;?
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
        Section 58BB scales the standard to your size, services and scam
        exposure — and Treasury expects larger entities to go beyond the
        minimum.
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
        Treasury&apos;s position paper is direct: <em>&ldquo;Reasonable steps
        involve businesses taking genuine, proactive and proportionate actions
        to reduce scam activity.&rdquo;</em> Larger businesses or those facing
        higher scam risks <em>&ldquo;may be expected to go beyond minimum
        requirements.&rdquo;</em>
      </Text>

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
          What this means in practice
        </Heading>
        <div style={{ paddingTop: "12px" }}>
          {POINTS.map((p, i) => (
            <div
              key={p.lead}
              style={{
                marginTop: i === 0 ? 0 : "10px",
                paddingBottom: i === POINTS.length - 1 ? 0 : "10px",
                borderBottom:
                  i === POINTS.length - 1 ? "none" : `1px solid ${DIVIDER}`,
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
                <strong>{p.lead}</strong> — {p.rest}
              </Text>
            </div>
          ))}
        </div>
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
        Critically, <strong>Section 58BT</strong> explicitly contemplates
        &ldquo;authorised third party data gateways&rdquo; — a statutory
        category for platforms like Ask Arthur. Contributing scam intelligence
        to Ask Arthur supports your Detect, Report, Disrupt and Governance
        obligations simultaneously.
      </Text>

      <div style={{ paddingTop: "24px" }}>
        <Link
          href="https://askarthur.au/banking"
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
          See How Ask Arthur Helps
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

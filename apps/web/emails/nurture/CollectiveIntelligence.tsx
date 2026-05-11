// Nurture step 3 (Day 7) — collective intelligence pitch.
//
// Refactored 2026-05-11 onto EditorialBriefingLayout. Leads with the
// 13% detection-rate stat from ASIC REP 761 in a single-tile callout.

import {
  Section,
  Text,
  Link,
  Heading,
} from "@react-email/components";
import EditorialBriefingLayout from "../_layout/EditorialBriefingLayout";
import { DIVIDER, NAVY, SANS, SERIF, SURFACE_TINT } from "../_layout/tokens";

interface CollectiveIntelligenceProps {
  name?: string;
  unsubscribeUrl?: string;
}

export default function CollectiveIntelligence({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: CollectiveIntelligenceProps) {
  return (
    <EditorialBriefingLayout
      preview="Why isolated scam prevention isn't enough — ASIC REP 761 found Big Four banks detected only 13% of scam payments."
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
        SPF Compliance · Brief 3 of 6
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
        Why isolated scam prevention isn&apos;t enough
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
        Scams don&apos;t respect organisational boundaries — a phishing URL
        that hits one bank today will hit three more tomorrow.
      </Text>

      {/* Single-tile stat callout */}
      <div style={{ paddingTop: "24px", paddingBottom: "8px" }}>
        <Section
          style={{
            backgroundColor: SURFACE_TINT,
            border: `1px solid ${DIVIDER}`,
            borderRadius: "10px",
            padding: "24px 20px",
            textAlign: "center" as const,
          }}
        >
          <Text
            style={{
              margin: 0,
              padding: 0,
              fontFamily: SERIF,
              fontSize: "40px",
              lineHeight: "44px",
              fontWeight: 600,
              color: NAVY,
            }}
          >
            13%
          </Text>
          <Text
            style={{
              margin: "6px 0 0 0",
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
            of scam payments detected by Big Four banks (ASIC REP 761)
          </Text>
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
        Ask Arthur&apos;s Threat API turns this problem into an advantage.
        Every API call your organisation makes does two things at once:
        protects your customers with AI-powered scam detection, and
        strengthens the network by contributing anonymised threat intelligence.
      </Text>

      <Text
        style={{
          margin: "16px 0 0 0",
          padding: 0,
          fontFamily: SERIF,
          fontSize: "16px",
          lineHeight: "26px",
          color: NAVY,
        }}
      >
        The result: a scam URL flagged by one organisation is immediately
        available to protect customers across the entire network — precisely
        the kind of cross-ecosystem collaboration the SPF Act&apos;s Disrupt
        principle demands.
      </Text>

      <div style={{ paddingTop: "24px" }}>
        <Link
          href="https://askarthur.au/api/v1/openapi.json"
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
          Explore the Threat API
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

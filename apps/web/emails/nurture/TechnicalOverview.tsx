// Nurture step 5 (Day 18) — technical-stakeholder API overview.
//
// Refactored 2026-05-11 onto EditorialBriefingLayout. Endpoint list
// and quick-start curl block keep their monospace treatment but now
// sit in the briefing's typographic frame.

import { Section, Text, Link, Heading } from "@react-email/components";
import EditorialBriefingLayout from "../_layout/EditorialBriefingLayout";
import { DIVIDER, NAVY, SANS, SERIF } from "../_layout/tokens";

interface TechnicalOverviewProps {
  name?: string;
  unsubscribeUrl?: string;
}

const ENDPOINTS: ReadonlyArray<{ verb: string; path: string; gloss: string }> =
  [
    { verb: "GET", path: "/api/v1/entities/lookup", gloss: "Entity reputation check" },
    { verb: "GET", path: "/api/v1/threats/urls/lookup", gloss: "URL threat analysis" },
    { verb: "GET", path: "/api/v1/threats/domains", gloss: "Domain intelligence" },
    { verb: "GET", path: "/api/v1/threats/wallets/lookup", gloss: "Crypto wallet check" },
    { verb: "GET", path: "/api/v1/threats/trending", gloss: "Trending threats" },
    { verb: "GET", path: "/api/v1/threats/stats", gloss: "Network statistics" },
  ];

const MONO = "'SF Mono', Menlo, Monaco, Consolas, monospace";

export default function TechnicalOverview({
  name = "",
  unsubscribeUrl = "https://askarthur.au/unsubscribe",
}: TechnicalOverviewProps) {
  return (
    <EditorialBriefingLayout
      preview="Six API endpoints. Live in under a day. Bearer auth, sub-200ms response, OpenAPI 3.0."
      headerLabel="Engineering Brief"
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
        SPF Compliance · Brief 5 of 6
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
        Six API endpoints. Live in under a day.
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
        For the technical stakeholder in your team — feel free to forward.
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

      {/* Endpoint table */}
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
          The Threat API
        </Heading>
        <div style={{ paddingTop: "12px" }}>
          {ENDPOINTS.map((e, i) => (
            <div
              key={e.path}
              style={{
                marginTop: i === 0 ? 0 : "8px",
                paddingBottom: i === ENDPOINTS.length - 1 ? 0 : "8px",
                borderBottom:
                  i === ENDPOINTS.length - 1 ? "none" : `1px solid ${DIVIDER}`,
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
                }}
              >
                <strong>{e.verb}</strong> {e.path}
              </Text>
              <Text
                style={{
                  margin: "2px 0 0 0",
                  padding: 0,
                  fontFamily: SERIF,
                  fontSize: "14px",
                  lineHeight: "20px",
                  color: NAVY,
                  opacity: 0.75,
                }}
              >
                {e.gloss}
              </Text>
            </div>
          ))}
        </div>
      </div>

      {/* Quick start curl block */}
      <div style={{ paddingTop: "24px" }}>
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
          Quick start
        </Text>
        <Section
          style={{
            backgroundColor: NAVY,
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
              color: "#E2E8F0",
              whiteSpace: "pre-wrap" as const,
            }}
          >
            {`curl -H "Authorization: Bearer YOUR_API_KEY" \\
  https://askarthur.au/api/v1/threats/urls/lookup?url=suspicious.example.com`}
          </Text>
        </Section>
      </div>

      <Text
        style={{
          margin: "20px 0 0 0",
          padding: 0,
          fontFamily: SERIF,
          fontSize: "16px",
          lineHeight: "26px",
          color: NAVY,
        }}
      >
        <strong>Auth:</strong> bearer token via API key &nbsp;·&nbsp;{" "}
        <strong>Rate limit:</strong> 60 RPM free, 300 RPM enterprise &nbsp;·&nbsp;{" "}
        <strong>Latency:</strong> &lt; 200ms typical &nbsp;·&nbsp;{" "}
        <strong>Format:</strong> JSON with structured verdicts
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
        Every API call is logged in your organisation&apos;s compliance
        dashboard with timestamps, endpoints and response codes — ready for
        regulatory audit at any time.
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
          View API Documentation
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

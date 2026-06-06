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
} from "@react-email/components";

export interface CloneWatchRunSummaryItem {
  brand: string;
  candidateDomain: string;
  candidateUrl: string;
  /** Hosting attribution already captured by urlscan (urlscan_evidence.server). */
  hostingIp: string | null;
  hostingCountry: string | null;
  asn: string | null;
  screenshotUrl?: string | null;
}

export interface CloneWatchRunSummaryProps {
  /** YYYY-MM-DD of the auto-triage run. */
  runDate: string;
  /** Counts for the run. */
  eligible: number;
  confirmed: number;
  offline: number;
  /** One row per auto-confirmed (live) clone. */
  items: CloneWatchRunSummaryItem[];
}

/**
 * Clone-watch auto-triage RUN SUMMARY — one internal/shadow digest per run,
 * replacing the previous one-email-per-clone behaviour. Lists every clone
 * auto-confirmed this run with the hosting attribution (IP / country / ASN)
 * urlscan already captured, so the operator sees brand + count + where the
 * cloner is hosted at a glance.
 *
 * Internal (admin/shadow) email — NOT brand-facing — so no editable copy slots
 * or #371 wording. Visual chrome matches CloneWatchBrandAlert / brand-stewardship.
 */
export default function CloneWatchRunSummary({
  runDate,
  eligible,
  confirmed,
  offline,
  items,
}: CloneWatchRunSummaryProps) {
  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>{`Clone-watch auto-triage — ${confirmed} confirmed (${runDate})`}</Preview>
      <Body
        style={{
          backgroundColor: "#F8FAFC",
          fontFamily:
            "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "600px", margin: "0 auto", padding: "40px 20px" }}>
          <Section
            style={{
              backgroundColor: "#1B2A4A",
              borderRadius: "8px 8px 0 0",
              padding: "24px 28px",
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "2px",
                textTransform: "uppercase" as const,
                margin: 0,
              }}
            >
              Ask Arthur · Clone-watch
            </Text>
            <Heading
              as="h1"
              style={{ color: "#FFFFFF", fontSize: "20px", fontWeight: 700, margin: "8px 0 2px 0" }}
            >
              Auto-triage run summary
            </Heading>
            <Text style={{ color: "#B8C1D1", fontSize: "14px", margin: 0 }}>{runDate}</Text>
          </Section>

          <Section
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "0 0 8px 8px",
              padding: "28px",
              border: "1px solid #E2E8F0",
              borderTop: "none",
            }}
          >
            <Text style={{ color: "#334155", fontSize: "14px", lineHeight: "1.6", margin: "0 0 18px 0" }}>
              <strong>{confirmed}</strong> clone{confirmed === 1 ? "" : "s"} auto-confirmed
              this run (of <strong>{eligible}</strong> strict-bar eligible
              {offline > 0 ? `, ${offline} skipped offline` : ""}). Hosting
              attribution below is from urlscan; ambiguous candidates remain in the
              manual queue.
            </Text>

            {items.length === 0 ? (
              <Text style={{ color: "#94A3B8", fontSize: "14px", margin: 0 }}>
                Nothing auto-confirmed this run.
              </Text>
            ) : (
              items.map((it, i) => (
                <Section
                  key={`${it.candidateDomain}-${i}`}
                  style={{
                    backgroundColor: "#F8FAFC",
                    border: "1px solid #E2E8F0",
                    borderRadius: "8px",
                    padding: "16px 18px",
                    margin: "0 0 12px 0",
                  }}
                >
                  <Text style={{ color: "#1B2A4A", fontSize: "14px", fontWeight: 700, margin: "0 0 4px 0" }}>
                    {it.brand}
                  </Text>
                  <Text style={{ margin: "0 0 8px 0" }}>
                    <Link href={it.candidateUrl} style={{ color: "#0F766E", fontSize: "13px" }}>
                      {it.candidateDomain}
                    </Link>
                  </Text>
                  <Text style={{ color: "#475569", fontSize: "12px", lineHeight: "1.6", margin: 0 }}>
                    Hosting IP: <code style={codeInline}>{it.hostingIp ?? "—"}</code>
                    {"  ·  "}Country: <code style={codeInline}>{it.hostingCountry ?? "—"}</code>
                    {"  ·  "}ASN: <code style={codeInline}>{it.asn ?? "—"}</code>
                  </Text>
                  {it.screenshotUrl && (
                    <Text style={{ margin: "8px 0 0 0" }}>
                      <Link href={it.screenshotUrl} style={{ color: "#64748B", fontSize: "12px" }}>
                        View screenshot
                      </Link>
                    </Text>
                  )}
                </Section>
              ))
            )}

            <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
            <Text style={{ color: "#64748B", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
              Review queue:{" "}
              <Link href="https://askarthur.au/admin/clone-watch" style={{ color: "#0F766E" }}>
                askarthur.au/admin/clone-watch
              </Link>
              . Hosting country is the cloner&apos;s <em>infrastructure</em>, not
              their location. Internal summary — not sent to any brand.
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: "12px", margin: "12px 0 0 0" }}>
              Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const codeInline = {
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: "11px",
  color: "#0F172A",
  backgroundColor: "#F1F5F9",
  padding: "1px 4px",
  borderRadius: "3px",
} as const;

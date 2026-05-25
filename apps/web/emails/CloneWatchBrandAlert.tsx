import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Link,
  Hr,
} from "@react-email/components";

export interface CloneWatchBrandAlertProps {
  brandName: string;
  legitimateDomain: string;
  candidateDomain: string;
  candidateUrl: string;
  signalType: string; // 'substring' | 'levenshtein' | 'confusable'
  score: number;
  firstSeenAt: string; // ISO
  evidenceSummary: string; // free-form one-line description
  netcraftSubmissionId?: string;
  ackRequestUrl?: string;
}

/**
 * Factual-signal alert to a brand's security / fraud / abuse team.
 *
 * Tone matches Netcraft / BrandShield / Bolster industry practice:
 * - report a signal, not a verdict
 * - never call the operator a "scammer" or "fraudster"
 * - put the brand's takedown team in the driver's seat
 *
 * Used by both Layer 3 (formal channels — security.txt + Bugcrowd VDP) and
 * Layer 4 (courtesy fraud-inbox sends). Same body, the channel-type just
 * routes to the right recipient.
 */
export default function CloneWatchBrandAlert({
  brandName,
  legitimateDomain,
  candidateDomain,
  candidateUrl,
  signalType,
  score,
  firstSeenAt,
  evidenceSummary,
  netcraftSubmissionId,
  ackRequestUrl,
}: CloneWatchBrandAlertProps) {
  const signalLabel =
    signalType === "levenshtein"
      ? "one-character typosquat"
      : signalType === "confusable"
        ? "Unicode look-alike domain"
        : signalType === "substring"
          ? "brand-string substring match"
          : "lexical match";

  return (
    <Html>
      <Head />
      <Preview>
        Possible clone domain matching {brandName} — {candidateDomain}
      </Preview>
      <Body
        style={{
          fontFamily:
            "Arial, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          color: "#0F172A",
          backgroundColor: "#FFFFFF",
        }}
      >
        <Container
          style={{
            maxWidth: "640px",
            margin: "0 auto",
            padding: "32px 24px",
          }}
        >
          <Heading as="h2" style={{ fontSize: "20px", margin: "0 0 16px 0" }}>
            Possible clone domain matching {brandName}
          </Heading>

          <Text style={{ fontSize: "14px", lineHeight: 1.6 }}>
            Hello {brandName} security team,
          </Text>

          <Text style={{ fontSize: "14px", lineHeight: 1.6 }}>
            Ask Arthur (askarthur.au) runs a daily lexical sweep of newly
            registered domains against a watchlist of Australian brands. The
            domain below surfaced as a {signalLabel} of <strong>{legitimateDomain}</strong>{" "}
            and may be worth your fraud / takedown team&apos;s attention.
          </Text>

          <Section style={{ marginTop: "24px" }}>
            <Heading
              as="h3"
              style={{ fontSize: "16px", margin: "0 0 12px 0" }}
            >
              Signal
            </Heading>
            <Row label="Candidate domain" value={candidateDomain} />
            <Row label="Candidate URL" value={candidateUrl} />
            <Row label="Matched brand" value={legitimateDomain} />
            <Row label="Signal type" value={signalType} />
            <Row label="Match score" value={score.toFixed(2)} />
            <Row
              label="First seen"
              value={new Date(firstSeenAt).toISOString()}
            />
            {evidenceSummary && (
              <Row label="Evidence" value={evidenceSummary} />
            )}
            {netcraftSubmissionId && (
              <Row
                label="Netcraft ref"
                value={netcraftSubmissionId}
              />
            )}
          </Section>

          <Section style={{ marginTop: "24px" }}>
            <Heading
              as="h3"
              style={{ fontSize: "16px", margin: "0 0 12px 0" }}
            >
              What we&apos;ve done
            </Heading>
            <Text style={{ fontSize: "13px", lineHeight: 1.6 }}>
              {netcraftSubmissionId
                ? `Submitted to Netcraft for community blocklist + browser-block coverage (ref ${netcraftSubmissionId}).`
                : "We have NOT yet submitted this to community blocklists — sharing the signal with you first."}
            </Text>
          </Section>

          <Section style={{ marginTop: "24px" }}>
            <Heading
              as="h3"
              style={{ fontSize: "16px", margin: "0 0 12px 0" }}
            >
              What you might do
            </Heading>
            <Text style={{ fontSize: "13px", lineHeight: 1.6 }}>
              If this matches your fraud-monitoring criteria, common next steps
              are: filing an abuse report with the registrar, requesting
              browser-vendor blocking, or escalating to your trademark counsel.
              If you&apos;d like the underlying evidence pack in a different
              format, reply to this email and we&apos;ll share it.
            </Text>
            {ackRequestUrl && (
              <Text style={{ fontSize: "13px", lineHeight: 1.6 }}>
                Let us know what action you took:{" "}
                <Link href={ackRequestUrl} style={{ color: "#0F766E" }}>
                  acknowledge receipt
                </Link>
                . Useful for our weekly impact report.
              </Text>
            )}
          </Section>

          <Hr style={{ borderColor: "#E2E8F0", margin: "32px 0 16px 0" }} />

          <Text style={{ fontSize: "12px", color: "#64748B", lineHeight: 1.6 }}>
            This is a factual signal report, not a determination that the
            domain is malicious. Ask Arthur does not file takedowns on behalf
            of brands; we surface candidates and submit to community blocklist
            aggregators. Reply <strong>STOP</strong> to suppress future
            notifications about this brand. Reply <strong>FALSE POSITIVE</strong>{" "}
            with the candidate domain to help us improve the matcher.
          </Text>
          <Text style={{ fontSize: "12px", color: "#64748B" }}>
            <Link
              href="https://askarthur.au/clone-watch"
              style={{ color: "#0F766E" }}
            >
              askarthur.au/clone-watch
            </Link>{" "}
            ·{" "}
            <Link href="https://askarthur.au/privacy" style={{ color: "#0F766E" }}>
              Privacy
            </Link>{" "}
            ·{" "}
            <Link href="mailto:brendan@askarthur.au" style={{ color: "#0F766E" }}>
              brendan@askarthur.au
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text
      style={{
        fontSize: "13px",
        margin: "4px 0",
        lineHeight: 1.5,
      }}
    >
      <span
        style={{ color: "#64748B", display: "inline-block", width: "140px" }}
      >
        {label}
      </span>
      <span
        style={{
          color: "#0F172A",
          wordBreak: "break-all",
          fontFamily:
            "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
        }}
      >
        {value}
      </span>
    </Text>
  );
}

import {
  Heading,
  Text,
  Link,
  Section,
  Hr,
  Row,
  Column,
} from "@react-email/components";
import EditorialBriefingLayout from "./_layout/EditorialBriefingLayout";
import {
  DIVIDER,
  NAVY,
  SANS,
  SERIF,
  TEXT_MUTED,
  WHITE,
} from "./_layout/tokens";

export interface CloneWatchBrandAlertProps {
  brandName: string;
  legitimateDomain: string;
  candidateDomain: string;
  candidateUrl: string;
  signalType: string; // 'substring' | 'levenshtein' | 'confusable'
  score: number;
  firstSeenAt: string; // ISO
  evidenceSummary: string;
  netcraftSubmissionId?: string;
  /** Optional ack URL — when present, renders a teal-pill CTA so the brand
   *  team can confirm receipt and tell us what they're doing. Helps populate
   *  the weekly impact digest. */
  ackRequestUrl?: string;
  /** Optional Ask Arthur ref for support correlation (defaults to the
   *  candidate domain — every email is identifiable by domain anyway). */
  reportRef?: string;
}

/**
 * Factual-signal alert to a brand's security / fraud / abuse team.
 *
 * Uses the shared EditorialBriefingLayout so the chrome (navy header,
 * white card, navy footer with ABN + unsubscribe) matches every other
 * outbound Ask Arthur email (WeeklyDigest, WeeklyIntelDigest, nurture
 * sequence).
 *
 * Tone: factual signal language. Never characterise the operator. Same
 * defensive posture Netcraft / Bolster use without lawyer-vetted copy.
 *
 * Used by Layer 3 (formal channels: Bugcrowd VDP, security.txt) and
 * Layer 4 (courtesy fraud-inbox sends) — same body, channel-type routes.
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
  reportRef,
}: CloneWatchBrandAlertProps) {
  const signalLabel = describeSignal(signalType);
  const ref = reportRef ?? `CW-${candidateDomain}`;
  const stopMailto = `mailto:brendan@askarthur.au?subject=${encodeURIComponent(
    `STOP clone-watch notifications — ${brandName}`,
  )}&body=${encodeURIComponent(
    `Please stop sending clone-watch notifications for ${brandName} (${legitimateDomain}). Ref: ${ref}.`,
  )}`;

  return (
    <EditorialBriefingLayout
      preview={`Possible clone domain matching ${brandName} — ${candidateDomain}`}
      headerLabel="Clone-watch alert"
      unsubscribeUrl={stopMailto}
      subscriptionReason={`You're receiving this because Ask Arthur's daily lexical sweep of newly-registered domains matched the candidate below against your brand ${brandName}. Reply STOP or use the link below to suppress future notifications about this brand.`}
    >
      <Heading
        as="h1"
        style={{
          margin: "0 0 12px 0",
          fontFamily: SERIF,
          fontSize: "26px",
          lineHeight: "32px",
          fontWeight: 700,
          color: NAVY,
        }}
      >
        Possible clone domain matching {brandName}
      </Heading>

      <Text
        style={{
          margin: "0 0 20px 0",
          fontFamily: SANS,
          fontSize: "14px",
          lineHeight: "22px",
          color: "#334155",
        }}
      >
        Hello {brandName} security team — Ask Arthur (askarthur.au) runs a
        daily lexical sweep of newly-registered domains against a watchlist
        of Australian brands. The domain below surfaced as a {signalLabel} of{" "}
        <strong>{legitimateDomain}</strong> and may be worth your fraud /
        takedown team&apos;s attention.
      </Text>

      <SignalBlock
        candidateDomain={candidateDomain}
        candidateUrl={candidateUrl}
        legitimateDomain={legitimateDomain}
        signalType={signalType}
        score={score}
        firstSeenAt={firstSeenAt}
        evidenceSummary={evidenceSummary}
        netcraftSubmissionId={netcraftSubmissionId}
      />

      <Hr style={{ borderColor: DIVIDER, margin: "24px 0" }} />

      <SectionHeading>What we&apos;ve done</SectionHeading>
      <Text
        style={bodyTextStyle}
      >
        {netcraftSubmissionId ? (
          <>
            Submitted to Netcraft for community blocklist + browser-block
            coverage. Netcraft submission ref:{" "}
            <code style={codeInlineStyle}>{netcraftSubmissionId}</code>.
          </>
        ) : (
          <>
            We have not yet submitted this to community blocklists —
            sharing the signal with you first.
          </>
        )}
      </Text>

      <SectionHeading>What you might do</SectionHeading>
      <Text style={bodyTextStyle}>
        If this matches your fraud-monitoring criteria, common next steps
        are filing an abuse report with the registrar, requesting
        browser-vendor blocking, or escalating to your trademark counsel.
        Reply to this email if you&apos;d like the underlying evidence pack
        in a different format.
      </Text>

      {ackRequestUrl && (
        <Section style={{ marginTop: "24px" }}>
          <Link
            href={ackRequestUrl}
            style={{
              display: "inline-block",
              backgroundColor: "#0D9488",
              color: WHITE,
              fontSize: "14px",
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: "6px",
              textDecoration: "none",
              fontFamily: SANS,
            }}
          >
            Acknowledge receipt
          </Link>
          <Text
            style={{
              ...bodyTextStyle,
              fontSize: "12px",
              color: TEXT_MUTED,
              marginTop: "8px",
            }}
          >
            Helps us populate the weekly impact digest. Optional.
          </Text>
        </Section>
      )}

      <Hr style={{ borderColor: DIVIDER, margin: "24px 0" }} />

      <Text
        style={{
          margin: 0,
          fontFamily: SANS,
          fontSize: "12px",
          lineHeight: "18px",
          color: TEXT_MUTED,
        }}
      >
        This is a factual signal report, not a determination that the
        domain is malicious. Ask Arthur does not file takedowns on behalf
        of brands; we surface candidates and submit to community blocklist
        aggregators. Reply <strong>FALSE POSITIVE</strong> with the
        candidate domain to help us improve the matcher. Ref:{" "}
        <code style={codeInlineStyle}>{ref}</code>
      </Text>
    </EditorialBriefingLayout>
  );
}

function SignalBlock({
  candidateDomain,
  candidateUrl,
  legitimateDomain,
  signalType,
  score,
  firstSeenAt,
  evidenceSummary,
  netcraftSubmissionId,
}: {
  candidateDomain: string;
  candidateUrl: string;
  legitimateDomain: string;
  signalType: string;
  score: number;
  firstSeenAt: string;
  evidenceSummary: string;
  netcraftSubmissionId?: string;
}) {
  return (
    <Section
      style={{
        backgroundColor: "#F8FAFC",
        border: `1px solid ${DIVIDER}`,
        borderRadius: "8px",
        padding: "16px 20px",
      }}
    >
      <SignalRow label="Candidate domain" value={candidateDomain} mono />
      <SignalRow label="Candidate URL" value={candidateUrl} mono />
      <SignalRow label="Matched brand" value={legitimateDomain} mono />
      <SignalRow label="Signal type" value={signalType} />
      <SignalRow label="Match score" value={score.toFixed(2)} />
      <SignalRow
        label="First seen"
        value={new Date(firstSeenAt).toISOString()}
      />
      {evidenceSummary && (
        <SignalRow label="Evidence" value={evidenceSummary} />
      )}
      {netcraftSubmissionId && (
        <SignalRow label="Netcraft ref" value={netcraftSubmissionId} mono />
      )}
    </Section>
  );
}

function SignalRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <Row style={{ marginBottom: "6px" }}>
      <Column
        style={{
          width: "120px",
          verticalAlign: "top",
          paddingRight: "8px",
        }}
      >
        <Text
          style={{
            margin: 0,
            fontFamily: SANS,
            fontSize: "11px",
            textTransform: "uppercase" as const,
            letterSpacing: "0.05em",
            color: TEXT_MUTED,
            lineHeight: "18px",
          }}
        >
          {label}
        </Text>
      </Column>
      <Column style={{ verticalAlign: "top" }}>
        <Text
          style={{
            margin: 0,
            fontFamily: mono
              ? "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace"
              : SANS,
            fontSize: "13px",
            lineHeight: "18px",
            color: "#0F172A",
            wordBreak: "break-all",
          }}
        >
          {value}
        </Text>
      </Column>
    </Row>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <Heading
      as="h3"
      style={{
        margin: "0 0 8px 0",
        fontFamily: SERIF,
        fontSize: "16px",
        lineHeight: "22px",
        fontWeight: 700,
        color: NAVY,
      }}
    >
      {children}
    </Heading>
  );
}

const bodyTextStyle = {
  margin: "0 0 16px 0",
  fontFamily: SANS,
  fontSize: "14px",
  lineHeight: "22px",
  color: "#334155",
} as const;

const codeInlineStyle = {
  fontFamily:
    "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: "12px",
  color: "#0F172A",
} as const;

function describeSignal(signalType: string): string {
  switch (signalType) {
    case "levenshtein":
      return "one-character typosquat";
    case "confusable":
      return "Unicode look-alike domain";
    case "substring":
      return "brand-string substring match";
    default:
      return "lexical match";
  }
}

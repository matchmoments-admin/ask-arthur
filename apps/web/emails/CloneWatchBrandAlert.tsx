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
  Img,
} from "@react-email/components";
import { renderCopySlot } from "@/lib/email/resolve-copy";
import { CLONE_WATCH_SLOTS } from "@/lib/email/copy-registry";

export interface CloneWatchCandidate {
  candidateDomain: string;
  candidateUrl: string;
  signalType: string;
  score: number;
  firstSeenAt: string;
  evidenceSummary: string;
  netcraftSubmissionId?: string;
  /** Public urlscan.io result page (always available when a urlscan
   *  submission was attempted, even if retrieval timed out). Lets the
   *  recipient inspect the live site evidence WITHOUT visiting the
   *  candidate URL directly. */
  urlscanResultUrl?: string;
  /** Screenshot URL from urlscan_evidence.screenshot_url. Only present
   *  when retrieval succeeded — embedded as a thumbnail in the email. */
  urlscanScreenshotUrl?: string;
}

export interface CloneWatchBrandAlertProps {
  brandName: string;
  legitimateDomain: string;
  /** Either a single candidate (legacy single-hit path — kept for back-compat
   *  with any non-batched call sites) OR an array of N candidates that ship
   *  as ONE consolidated email (PR-B2 batched-daily flow). When `candidates`
   *  is provided it takes precedence; otherwise the singular fields below
   *  synthesise a one-element array. */
  candidates?: CloneWatchCandidate[];
  candidateDomain?: string;
  candidateUrl?: string;
  signalType?: string;
  score?: number;
  firstSeenAt?: string;
  evidenceSummary?: string;
  netcraftSubmissionId?: string;
  /** Optional ack URL — when present, renders a teal-pill CTA so the brand
   *  team can confirm receipt and tell us what they're doing. */
  ackRequestUrl?: string;
  /** Optional Ask Arthur ref for support correlation (defaults to the
   *  candidate domain — every email is identifiable by domain anyway). */
  reportRef?: string;
  /** Editable prose overrides (Email Studio). Falls back to slot defaults. */
  copy?: Record<string, string>;
}

/**
 * Factual-signal alert to a brand's security / fraud / abuse team.
 *
 * Visual style matches WeeklyDigest.tsx (Public Sans, navy header card,
 * teal CTAs, 560px container) so all outbound Ask Arthur emails share the
 * same chrome. Earlier revisions used the EditorialBriefingLayout which
 * read as too SPF/editorial for a one-shot brand notification.
 *
 * Tone: factual signal language. Never characterise the operator.
 *
 * Used by Layer 3 (formal channels: Bugcrowd VDP, security.txt) and
 * Layer 4 (courtesy fraud-inbox sends) — same body, channel-type routes.
 */
export default function CloneWatchBrandAlert(
  props: CloneWatchBrandAlertProps,
) {
  const { brandName, legitimateDomain, ackRequestUrl, reportRef, copy } = props;
  const slot = (key: keyof typeof CLONE_WATCH_SLOTS) =>
    renderCopySlot(copy?.[key] ?? CLONE_WATCH_SLOTS[key].default, {
      brandName,
      legitimateDomain,
    });

  // Normalise to candidates[] regardless of which prop shape the caller used.
  const candidates: CloneWatchCandidate[] =
    props.candidates && props.candidates.length > 0
      ? props.candidates
      : [
          {
            candidateDomain: props.candidateDomain ?? "",
            candidateUrl: props.candidateUrl ?? "",
            signalType: props.signalType ?? "lexical",
            score: props.score ?? 0,
            firstSeenAt: props.firstSeenAt ?? new Date().toISOString(),
            evidenceSummary: props.evidenceSummary ?? "",
            netcraftSubmissionId: props.netcraftSubmissionId,
          },
        ];
  const isBatch = candidates.length > 1;
  const primary = candidates[0];
  const ref =
    reportRef ??
    (isBatch ? `CW-batch-${brandName}` : `CW-${primary.candidateDomain}`);
  const stopMailto = `mailto:brendan@askarthur.au?subject=${encodeURIComponent(
    `STOP clone-watch notifications — ${brandName}`,
  )}&body=${encodeURIComponent(
    `Please stop sending clone-watch notifications for ${brandName} (${legitimateDomain}). Ref: ${ref}.`,
  )}`;

  const previewText = isBatch
    ? `${candidates.length} possible clones matching ${brandName}`
    : `Possible clone domain matching ${brandName} — ${primary.candidateDomain}`;

  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>{previewText}</Preview>
      <Body
        style={{
          backgroundColor: "#F8FAFC",
          fontFamily:
            "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <Container
          style={{
            maxWidth: "560px",
            margin: "0 auto",
            padding: "40px 20px",
          }}
        >
          {/* Header */}
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
              Ask Arthur
            </Text>
            <Heading
              as="h1"
              style={{
                color: "#FFFFFF",
                fontSize: "22px",
                fontWeight: 700,
                margin: "8px 0 0 0",
              }}
            >
              Clone-watch alert
            </Heading>
          </Section>

          {/* Body */}
          <Section
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: "0 0 8px 8px",
              padding: "28px",
              border: "1px solid #E2E8F0",
              borderTop: "none",
            }}
          >
            <Text
              style={{
                color: "#334155",
                fontSize: "16px",
                lineHeight: "1.6",
                margin: "0 0 16px 0",
              }}
            >
              Hello <strong>{brandName}</strong> team — Ask Arthur runs a
              daily lexical sweep of newly-registered domains against a
              watchlist of Australian brands.{" "}
              {isBatch ? (
                <>
                  <strong>{candidates.length} domains</strong> surfaced
                  overnight as possible clones of{" "}
                  <strong>{legitimateDomain}</strong> and may be worth your
                  fraud / takedown team&apos;s attention.
                </>
              ) : (
                <>
                  The domain below surfaced as a possible clone of{" "}
                  <strong>{legitimateDomain}</strong> and may be worth your
                  fraud / takedown team&apos;s attention.
                </>
              )}
            </Text>

            <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />

            {/* Candidates — numbered list, WeeklyDigest style */}
            {candidates.map((c, i) => (
              <Section key={c.candidateDomain} style={{ marginBottom: "20px" }}>
                <Text
                  style={{
                    color: "#1B2A4A",
                    fontSize: "15px",
                    fontWeight: 600,
                    margin: "0 0 6px 0",
                  }}
                >
                  {i + 1}. {c.candidateDomain}
                </Text>
                <Text
                  style={{
                    color: "#475569",
                    fontSize: "14px",
                    lineHeight: "1.5",
                    margin: "0 0 6px 0",
                  }}
                >
                  <strong>URL:</strong>{" "}
                  <code style={codeInline}>{c.candidateUrl}</code>
                </Text>
                <Text
                  style={{
                    color: "#475569",
                    fontSize: "14px",
                    lineHeight: "1.5",
                    margin: "0 0 6px 0",
                  }}
                >
                  <strong>Signal:</strong> {describeSignal(c.signalType)}
                  {c.score > 0 && (
                    <>
                      {" "}
                      &middot; match score{" "}
                      <code style={codeInline}>{c.score.toFixed(2)}</code>
                    </>
                  )}{" "}
                  &middot; first seen{" "}
                  <code style={codeInline}>
                    {new Date(c.firstSeenAt).toISOString().slice(0, 10)}
                  </code>
                </Text>
                {c.evidenceSummary && (
                  <Text
                    style={{
                      color: "#64748B",
                      fontSize: "13px",
                      lineHeight: "1.5",
                      margin: "0 0 6px 0",
                      fontStyle: "italic",
                    }}
                  >
                    {c.evidenceSummary}
                  </Text>
                )}
                {c.netcraftSubmissionId && (
                  <Text
                    style={{
                      color: "#475569",
                      fontSize: "13px",
                      lineHeight: "1.5",
                      margin: "0 0 6px 0",
                    }}
                  >
                    <strong>Netcraft ref:</strong>{" "}
                    <code style={codeInline}>{c.netcraftSubmissionId}</code>
                  </Text>
                )}
                {c.urlscanResultUrl && (
                  <Text
                    style={{
                      color: "#475569",
                      fontSize: "13px",
                      lineHeight: "1.5",
                      margin: "0 0 6px 0",
                    }}
                  >
                    <strong>Evidence:</strong>{" "}
                    <Link
                      href={c.urlscanResultUrl}
                      style={{ color: "#0D9488", textDecoration: "underline" }}
                    >
                      View urlscan.io scan
                    </Link>{" "}
                    <span style={{ color: "#94A3B8" }}>
                      &mdash; inspect the live site safely without visiting it
                    </span>
                  </Text>
                )}
                {c.urlscanScreenshotUrl && (
                  <Section style={{ margin: "8px 0 0 0" }}>
                    <Img
                      src={c.urlscanScreenshotUrl}
                      alt={`Screenshot of ${c.candidateDomain} via urlscan.io`}
                      width="500"
                      style={{
                        maxWidth: "500px",
                        width: "100%",
                        height: "auto",
                        border: "1px solid #E2E8F0",
                        borderRadius: "4px",
                        display: "block",
                      }}
                    />
                  </Section>
                )}
              </Section>
            ))}

            <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />

            <Heading
              as="h3"
              style={{
                color: "#1B2A4A",
                fontSize: "15px",
                fontWeight: 700,
                margin: "0 0 8px 0",
              }}
            >
              What we&apos;ve done
            </Heading>
            <Text
              style={{
                color: "#334155",
                fontSize: "14px",
                lineHeight: "1.6",
                margin: "0 0 16px 0",
              }}
            >
              {primary.netcraftSubmissionId ? (
                <>
                  Submitted to Netcraft for community blocklist +
                  browser-block coverage.{" "}
                  {isBatch
                    ? "First Netcraft submission ref"
                    : "Netcraft submission ref"}
                  :{" "}
                  <code style={codeInline}>{primary.netcraftSubmissionId}</code>
                  .
                </>
              ) : (
                <>
                  We have not yet submitted to community blocklists — sharing
                  the signal with you first.
                </>
              )}
            </Text>

            <Heading
              as="h3"
              style={{
                color: "#1B2A4A",
                fontSize: "15px",
                fontWeight: 700,
                margin: "0 0 8px 0",
              }}
            >
              What you might do
            </Heading>
            {/* Editable slot: what_you_might_do */}
            <div
              style={{
                color: "#334155",
                fontSize: "14px",
                lineHeight: "1.6",
                margin: "0 0 16px 0",
              }}
              dangerouslySetInnerHTML={{ __html: slot("what_you_might_do") }}
            />

            {ackRequestUrl && (
              <>
                <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
                <Link
                  href={ackRequestUrl}
                  style={{
                    display: "inline-block",
                    backgroundColor: "#0D9488",
                    color: "#FFFFFF",
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "10px 20px",
                    borderRadius: "6px",
                    textDecoration: "none",
                  }}
                >
                  Acknowledge receipt
                </Link>
                <Text
                  style={{
                    color: "#94A3B8",
                    fontSize: "12px",
                    margin: "8px 0 0 0",
                  }}
                >
                  Optional — helps us populate the weekly impact digest.
                </Text>
              </>
            )}

            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0" }} />

            <Text
              style={{
                color: "#64748B",
                fontSize: "12px",
                lineHeight: "1.5",
                margin: 0,
              }}
            >
              This is a factual signal report, not a determination that the
              domain is malicious. Ask Arthur does not file takedowns on
              behalf of brands; we surface candidates and submit to
              community blocklist aggregators. Reply{" "}
              <strong>FALSE POSITIVE</strong> with the candidate domain to
              help us improve the matcher. Ref:{" "}
              <code style={codeInline}>{ref}</code>
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                margin: "16px 0 0 0",
              }}
            >
              You&apos;re receiving this because Ask Arthur&apos;s daily
              lexical sweep matched the candidate above against your brand{" "}
              {brandName}.{" "}
              <Link href={stopMailto} style={{ color: "#94A3B8" }}>
                Stop notifications for this brand
              </Link>
            </Text>
            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                lineHeight: "1.5",
                margin: "8px 0 0 0",
              }}
            >
              Ask Arthur | ABN 72 695 772 313 | Sydney, Australia
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const codeInline = {
  fontFamily:
    "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: "12px",
  color: "#0F172A",
  backgroundColor: "#F1F5F9",
  padding: "1px 4px",
  borderRadius: "3px",
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

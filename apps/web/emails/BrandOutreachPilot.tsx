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
import { lifecycleBadge, classColor, classLabel } from "@/lib/clone-watch/outcome-copy";
import type { OutreachCloneSample, OutreachCloneRow } from "@/lib/email/brand-outreach-clones";

// Founder-composed pilot outreach email — the styled, data-backed successor to
// the plain-HTML note. Visual chrome matches BrandStewardshipReport /
// CloneWatchBrandAlert (navy header card, Public Sans, 560px, ABN footer) so
// every outbound Ask Arthur email reads as one brand.
//
// Structure: the founder's own note (sanitised markdown) up top as the personal
// pitch, then — when we hold data for the brand — a COMPACT sample of the
// lookalike domains we've detected + reported in the last 30 days as proof.
// The sample deliberately omits the stewardship report's self-serve takedown
// links: a cold pitch shows the problem and offers to do the work, it doesn't
// hand over the toolkit.
//
// Honesty: per-row badges + "reported to a takedown vendor" follow the same
// verb discipline as lib/clone-watch/outcome-copy.ts — never a takedown claim.

export const ASK_ARTHUR_ABN = "72 695 772 313";
export const ASK_ARTHUR_SENDER_NAME = "Brendan";
export const ASK_ARTHUR_SENDER_ROLE = "Founder, Ask Arthur";
export const ASK_ARTHUR_SITE = "https://askarthur.au";

export interface BrandOutreachPilotProps {
  brandName: string;
  /** The founder's note, already sanitised to email HTML (renderCopySlot). */
  bodyHtml: string;
  /** Live 30-day clone sample; omitted section when null/empty. */
  cloneSample?: OutreachCloneSample | null;
  /** Unsubscribe / STOP mailto shown in the footer. */
  stopUrl?: string;
}

export default function BrandOutreachPilot({
  brandName,
  bodyHtml,
  cloneSample,
  stopUrl,
}: BrandOutreachPilotProps) {
  const stopMailto =
    stopUrl ??
    `mailto:brendan@askarthur.au?subject=${encodeURIComponent(`STOP — ${brandName}`)}`;
  const hasSample = Boolean(cloneSample && cloneSample.total > 0 && cloneSample.rows.length > 0);

  // Precompute the sample sentences as whole strings — React's server renderer
  // can wedge comment markers between adjacent JSX text/expression children,
  // which would fragment phrases like "9 lookalike domains". Building them here
  // keeps the rendered HTML contiguous (and assertable).
  const detectedSentence = cloneSample
    ? `In the last 30 days we detected ${cloneSample.total} lookalike ` +
      `domain${cloneSample.total === 1 ? "" : "s"} impersonating ${brandName}` +
      (cloneSample.reported > 0
        ? ` and reported ${cloneSample.reported} of them to a takedown vendor on your behalf. A few examples:`
        : ". A few examples:")
    : "";
  const moreCount = cloneSample ? cloneSample.total - cloneSample.rows.length : 0;
  const moreSentence =
    moreCount > 0
      ? `+ ${moreCount} more — I can send the full evidence pack ` +
        `(screenshots, registration dates, hosting) on request.`
      : "";

  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>Lookalike-domain monitoring for {brandName} — a pilot from Ask Arthur</Preview>
      <Body
        style={{
          backgroundColor: "#F8FAFC",
          fontFamily:
            "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}>
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
              style={{ color: "#FFFFFF", fontSize: "22px", fontWeight: 700, margin: "8px 0 2px 0" }}
            >
              Lookalike-domain monitoring for {brandName}
            </Heading>
            <Text style={{ color: "#B8C1D1", fontSize: "14px", margin: 0 }}>
              A quick pilot from the founder
            </Text>
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
            {/* The founder's own note (sanitised markdown). */}
            <div
              style={{ color: "#334155", fontSize: "15px", lineHeight: "1.6", margin: "0 0 4px 0" }}
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />

            {/* Sign-off. */}
            <Text style={{ color: "#334155", fontSize: "14px", lineHeight: "1.5", margin: "18px 0 0 0" }}>
              {ASK_ARTHUR_SENDER_NAME}
              <br />
              {ASK_ARTHUR_SENDER_ROLE}
              <br />
              <Link href={ASK_ARTHUR_SITE} style={{ color: "#0F766E", textDecoration: "none" }}>
                askarthur.au
              </Link>
            </Text>

            {/* Data proof — a compact sample of what we've caught for the brand. */}
            {hasSample && cloneSample && (
              <>
                <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0 20px" }} />
                <Heading
                  as="h3"
                  style={{ color: "#1B2A4A", fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0" }}
                >
                  A sample of what we&apos;ve already caught for {brandName}
                </Heading>
                <Text
                  style={{ color: "#475569", fontSize: "13px", lineHeight: "1.6", margin: "0 0 14px 0" }}
                >
                  {detectedSentence}
                </Text>

                {cloneSample.rows.map((c) => (
                  <CloneRow key={c.domain} c={c} />
                ))}

                {moreSentence && (
                  <Text style={{ color: "#94A3B8", fontSize: "12px", margin: "6px 0 0 0" }}>
                    {moreSentence}
                  </Text>
                )}
              </>
            )}

            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0 16px" }} />

            <Text style={{ color: "#94A3B8", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
              {`Ask Arthur · ABN ${ASK_ARTHUR_ABN} · Sydney, Australia`}
            </Text>
            <Text style={{ color: "#94A3B8", fontSize: "12px", lineHeight: "1.5", margin: "6px 0 0 0" }}>
              {`Sent to ${brandName} as a one-off business enquiry. `}
              <Link href={stopMailto} style={{ color: "#94A3B8", textDecoration: "underline" }}>
                Reply STOP
              </Link>
              {" and I won't contact you again."}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

/** One compact clone row: classification-coloured left border, domain chip,
 *  lifecycle badge, and a first-seen + hosting metadata line. */
function CloneRow({ c }: { c: OutreachCloneRow }) {
  const badge = lifecycleBadge(c.lifecycleState ?? null);
  return (
    <Section
      style={{
        borderLeft: `3px solid ${classColor(c.classification)}`,
        backgroundColor: "#F8FAFC",
        borderRadius: "4px",
        padding: "10px 14px",
        margin: "0 0 8px 0",
      }}
    >
      <Text style={{ margin: "0 0 3px 0" }}>
        <code style={codeInline}>{c.domain}</code>
        {badge && (
          <span style={{ marginLeft: "8px", fontSize: "11px", fontWeight: 700, color: badge.color }}>
            {badge.label}
          </span>
        )}
        {c.classification && (
          <span
            style={{
              marginLeft: "8px",
              fontSize: "11px",
              fontWeight: 700,
              color: classColor(c.classification),
              textTransform: "uppercase" as const,
            }}
          >
            {classLabel(c.classification)}
          </span>
        )}
      </Text>
      <Text style={{ color: "#64748B", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
        {c.firstSeenAt && <>First seen {fmtDate(c.firstSeenAt)} &middot; </>}
        {hostingLine(c)}
      </Text>
      {c.registrar && (
        <Text style={{ color: "#64748B", fontSize: "12px", lineHeight: "1.5", margin: 0 }}>
          Registrar: {c.registrar}
        </Text>
      )}
    </Section>
  );
}

const codeInline = {
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: "12px",
  color: "#0F172A",
  backgroundColor: "#F1F5F9",
  padding: "1px 4px",
  borderRadius: "3px",
} as const;

/** "Hosted: <ip> · <ASN> · <country>" with graceful fallback. */
function hostingLine(c: OutreachCloneRow): string {
  const parts = [c.ip, c.asn, c.country].filter(Boolean) as string[];
  return parts.length > 0 ? `Hosted: ${parts.join(" · ")}` : "Hosting: not captured";
}

/** Short UTC date ("11 Jul 2026") — formatted from parts so the render is
 *  deterministic across Node ICU builds (matches BrandStewardshipReport). */
const FMT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getUTCDate()} ${FMT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

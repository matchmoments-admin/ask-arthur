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
import { WEAPONISED_CLONE_SLOTS } from "@/lib/email/copy-registry";

export interface WeaponisedCloneAlertProps {
  brandName: string;
  legitimateDomain: string;
  candidateDomain: string;
  candidateUrl: string;
  /** shopfront_clone_alerts.weaponised_at — the moment our scanner
   *  classified the clone as likely phishing. */
  weaponisedAt: string;
  /** Public urlscan.io result page — inspect without visiting. */
  urlscanResultUrl?: string;
  /** urlscan_evidence.screenshot_url — embedded when retrieval succeeded. */
  urlscanScreenshotUrl?: string;
  /** attribution.whois.* — the enricher only runs on confirmed alerts, so
   *  any of these may be absent; the template omits the row. */
  registrar?: string;
  registrarAbuseEmail?: string;
  /** attribution.hosting.* */
  hostingIp?: string;
  hostingCountry?: string;
  hostingAsn?: string;
  /** shopfront_clone_alerts.netcraft_declined_at — when set, renders the
   *  honesty line: the takedown vendor previously declined this domain
   *  because there was no live malicious content at the time. */
  netcraftDeclinedAt?: string;
  reportRef: string;
  /** Editable prose overrides (Email Studio). */
  copy?: Record<string, string>;
}

/**
 * URGENT weaponisation alert to a brand's security / fraud team — a
 * lookalike we were monitoring has flipped to serving suspected phishing
 * content (urlscan likely_phishing verdict). Single-candidate,
 * evidence-dense, sent via the four-eyes dashboard the moment the
 * weaponised.v1 event fires (not the daily digest).
 *
 * A separate template from CloneWatchBrandAlert deliberately: that file is
 * already dual-shape (batch + legacy single) and this content is
 * structurally different (urgent tone, weaponisation timeline, vendor
 * honesty line). HTML is frozen onto queue rows at staging time, so there
 * is no shared-render coupling to preserve.
 *
 * HONESTY INVARIANTS (tested in cloneWatchNotifyWeaponised.test.ts):
 *   - states the factual claim only — "our scanner classified X as likely
 *     phishing", never "confirmed phishing", never any takedown claim;
 *   - the vendor-decline line renders ONLY when netcraftDeclinedAt is set;
 *   - "what you can do" guides registrar-abuse / auDRP — never "we will
 *     file for you" (we have no standing).
 *
 * Visual chrome matches WeeklyDigest / CloneWatchBrandAlert (Public Sans,
 * navy header, 560px, teal links).
 */
export default function WeaponisedCloneAlert(props: WeaponisedCloneAlertProps) {
  const {
    brandName,
    legitimateDomain,
    candidateDomain,
    candidateUrl,
    weaponisedAt,
    urlscanResultUrl,
    urlscanScreenshotUrl,
    registrar,
    registrarAbuseEmail,
    hostingIp,
    hostingCountry,
    hostingAsn,
    netcraftDeclinedAt,
    reportRef,
    copy,
  } = props;

  const slot = (key: keyof typeof WEAPONISED_CLONE_SLOTS) =>
    renderCopySlot(copy?.[key] ?? WEAPONISED_CLONE_SLOTS[key].default, {
      brandName,
      legitimateDomain,
    });

  const stopMailto = `mailto:brendan@askarthur.au?subject=${encodeURIComponent(
    `STOP clone-watch notifications — ${brandName}`,
  )}&body=${encodeURIComponent(
    `Please stop sending clone-watch notifications for ${brandName} (${legitimateDomain}). Ref: ${reportRef}.`,
  )}`;

  const weaponisedDate = new Date(weaponisedAt).toISOString().slice(0, 10);
  const hostingBits = [
    hostingIp && `IP ${hostingIp}`,
    hostingCountry,
    hostingAsn && `ASN ${hostingAsn}`,
  ].filter(Boolean);

  return (
    <Html>
      <Head>
        <style>{`@import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap');`}</style>
      </Head>
      <Preview>
        {`Urgent: ${candidateDomain} — a lookalike of ${brandName} — is now serving suspected phishing content`}
      </Preview>
      <Body
        style={{
          backgroundColor: "#F8FAFC",
          fontFamily:
            "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <Container
          style={{ maxWidth: "560px", margin: "0 auto", padding: "40px 20px" }}
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
              Urgent — lookalike domain now live
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
              Hello <strong>{brandName}</strong> team — Ask Arthur has been
              monitoring lookalike domains of{" "}
              <strong>{legitimateDomain}</strong>. On{" "}
              <code style={codeInline}>{weaponisedDate}</code> our scanner
              classified the domain below as <strong>likely phishing</strong>{" "}
              — it has gone from dormant to serving live content that
              resembles a credential-harvesting or impersonation page. We are
              alerting you immediately because an impersonation of your brand
              may be underway right now.
            </Text>

            <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />

            {/* Evidence block */}
            <Text
              style={{
                color: "#1B2A4A",
                fontSize: "15px",
                fontWeight: 600,
                margin: "0 0 6px 0",
              }}
            >
              {candidateDomain}
            </Text>
            <Text style={detailRow}>
              <strong>URL:</strong> <code style={codeInline}>{candidateUrl}</code>
            </Text>
            <Text style={detailRow}>
              <strong>Classified likely phishing:</strong>{" "}
              <code style={codeInline}>{weaponisedDate}</code>
            </Text>
            {registrar && (
              <Text style={detailRow}>
                <strong>Registrar:</strong> {registrar}
                {registrarAbuseEmail && (
                  <>
                    {" "}
                    &middot; abuse contact{" "}
                    <code style={codeInline}>{registrarAbuseEmail}</code>
                  </>
                )}
              </Text>
            )}
            {hostingBits.length > 0 && (
              <Text style={detailRow}>
                <strong>Hosting:</strong> {hostingBits.join(" · ")}
              </Text>
            )}
            {urlscanResultUrl && (
              <Text style={detailRow}>
                <strong>Evidence:</strong>{" "}
                <Link
                  href={urlscanResultUrl}
                  style={{ color: "#0D9488", textDecoration: "underline" }}
                >
                  View urlscan.io scan
                </Link>{" "}
                <span style={{ color: "#94A3B8" }}>
                  &mdash; inspect the live site safely without visiting it
                </span>
              </Text>
            )}
            {urlscanScreenshotUrl && (
              <Section style={{ margin: "8px 0 0 0" }}>
                <Img
                  src={urlscanScreenshotUrl}
                  alt={`Screenshot of ${candidateDomain} via urlscan.io`}
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

            {netcraftDeclinedAt && (
              <>
                <Hr style={{ borderColor: "#E2E8F0", margin: "20px 0" }} />
                <Text
                  style={{
                    color: "#64748B",
                    fontSize: "13px",
                    lineHeight: "1.6",
                    margin: 0,
                  }}
                >
                  For context: we reported this domain to a takedown vendor on{" "}
                  <code style={codeInline}>
                    {new Date(netcraftDeclinedAt).toISOString().slice(0, 10)}
                  </code>
                  ; it was not actioned at that time because the site showed
                  no live malicious content then. It now does, and we are
                  re-escalating with the new evidence.
                </Text>
              </>
            )}

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
              What you can do now
            </Heading>
            {/* Editable slot: what_you_can_do */}
            <div
              style={{
                color: "#334155",
                fontSize: "14px",
                lineHeight: "1.6",
                margin: "0 0 16px 0",
              }}
              dangerouslySetInnerHTML={{ __html: slot("what_you_can_do") }}
            />

            <Hr style={{ borderColor: "#E2E8F0", margin: "24px 0" }} />

            <Text
              style={{
                color: "#64748B",
                fontSize: "12px",
                lineHeight: "1.5",
                margin: 0,
              }}
            >
              This is a factual signal report based on an automated scan, not
              a legal determination that the domain is malicious. Ask Arthur
              does not file takedowns on behalf of brands; we surface the
              evidence so your team can act. Reply{" "}
              <strong>FALSE POSITIVE</strong> with the domain if this is
              wrong — it helps us improve. Ref:{" "}
              <code style={codeInline}>{reportRef}</code>
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: "12px",
                margin: "16px 0 0 0",
              }}
            >
              You&apos;re receiving this because Ask Arthur monitors lookalike
              domains matching {brandName}.{" "}
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
  fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  fontSize: "12px",
  color: "#0F172A",
  backgroundColor: "#F1F5F9",
  padding: "1px 4px",
  borderRadius: "3px",
} as const;

const detailRow = {
  color: "#475569",
  fontSize: "14px",
  lineHeight: "1.5",
  margin: "0 0 6px 0",
} as const;

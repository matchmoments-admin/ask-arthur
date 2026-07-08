// Reddit-intel weekly digest — editorial briefing template.
//
// Adapted from the AskArthurBriefing reference design (navy + white only,
// Georgia serif headings + Arial sans labels, 640px max width). Signal-
// over-noise rebuild (2026-05-05): scannable stats lead, theme titles deep-
// link to durable /intel/themes/[slug] pages so brand readers can drill
// straight to the source Reddit posts.
//
// Slot mapping (intel data → briefing slots):
//   emergingThemes[0].title → headline (or fallback by post count)
//   emergingThemes[0].narrative (or fallback) → single dek line
//   stats card → 3 columns: Posts · Active themes · Brands flagged
//   emergingThemes[*]       → numbered list, "Emerging this week"
//                              titles link to /intel/themes/<slug|id>
//   topBrands               → sentence in "Brands impersonated"
//   scamOfTheWeekQuote      → tip callout (white card, navy border)
//   topCategories           → "By the numbers" sentence

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
  Button,
  Row,
  Column,
} from "@react-email/components";
import { withUtm } from "@/lib/utm";

interface EmergingTheme {
  /** UUID primary key — used as the deep-link fallback when slug is null. */
  id: string;
  /** URL-friendly slug; null on legacy rows and synthesis stories. */
  slug: string | null;
  title: string;
  narrative: string | null;
  memberCount: number;
  representativeBrands: string[];
  /** Deep link to a durable theme page. Null for synthesis stories, which
   *  have no per-theme page — those render as plain (non-linked) headlines. */
  href?: string | null;
  /** "New this week" / "Rising" chip, or null/undefined for no chip. */
  signalLabel?: string | null;
}

interface BrandWatchEntry {
  brand: string;
  mentionCount: number;
}

interface CategoryEntry {
  label: string;
  count: number;
}

export interface RegulatorAlertEntry {
  sourceLabel: string;
  title: string;
  url: string | null;
  publishedAt: string | null;
}

export interface CloneWatchEntry {
  /** The impersonating / cloned domain (no scheme). */
  fakeDomain: string;
  /** The brand it impersonates, if known. */
  brand: string | null;
  /** The brand's real/official domain, if known (for the "vs" contrast). */
  realDomain: string | null;
}

export interface WeeklyIntelDigestProps {
  weekStart: string;
  weekEnd: string;
  totalPostsClassified: number;
  emergingThemes: EmergingTheme[];
  topBrands: BrandWatchEntry[];
  topCategories: CategoryEntry[];
  scamOfTheWeekQuote: { text: string; speakerRole: string } | null;
  modelVersion: string;
  promptVersion: string;
  regulatorAlerts?: RegulatorAlertEntry[];
  /** Newly detected impersonation/cloned sites this week (clone-watch). Renders
   *  a "Clone Watch" section only when non-empty, so it vanishes on quiet weeks
   *  — the newsletter never depends on it. */
  cloneWatch?: CloneWatchEntry[];
}

// ── Brand palette (matches AskArthurBriefing) ─────────────────────────────
const NAVY = "#1B2A4A";
const NAVY_SOFT = "#B8C1D1";
const WHITE = "#FFFFFF";
const DIVIDER = "#E2E8F0";
const SURFACE_TINT = "#F8FAFC";
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";

const EMAIL_UTM = {
  source: "email",
  campaign: "weekly-intel-digest",
  medium: "email",
};

function humaniseDate(iso: string): string {
  // ISO date → "1 May" — short form for the briefing date band.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "long" });
}

function humaniseCategory(label: string): string {
  return label
    .split("_")
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Resolve a deep link for an emerging item, or null when it has no durable
// page. Synthesis stories (no href, no slug) return null → rendered as plain
// headlines. Theme rows carry a prebuilt UTM href, or a slug we build from.
function themeHref(theme: EmergingTheme): string | null {
  if (theme.href) return theme.href;
  if (theme.slug) {
    return withUtm(`https://askarthur.au/intel/themes/${theme.slug}`, EMAIL_UTM);
  }
  return null;
}

function buildDek(props: WeeklyIntelDigestProps): string {
  // Single tight line replacing the verbose lead-narrative paragraphs.
  // Prefer the top theme's narrative (truncated) so the dek tells the
  // reader what the headline scam actually is; fall back to a stats line.
  const top = props.emergingThemes[0];
  if (top?.narrative) {
    const cleaned = top.narrative.replace(/\s+/g, " ").trim();
    if (cleaned.length <= 120) return cleaned;
    return cleaned.slice(0, 117).trimEnd() + "…";
  }
  const themes = props.emergingThemes.length;
  return `${props.totalPostsClassified} Reddit reports analysed across ${themes} active scam pattern${themes === 1 ? "" : "s"}.`;
}

export default function WeeklyIntelDigest(props: WeeklyIntelDigestProps) {
  const {
    weekStart,
    weekEnd,
    totalPostsClassified,
    emergingThemes = [],
    topBrands = [],
    topCategories = [],
    scamOfTheWeekQuote,
    modelVersion,
    promptVersion,
    regulatorAlerts,
    cloneWatch,
  } = props;

  const headline =
    emergingThemes[0]?.title ??
    `${totalPostsClassified} scam reports analysed this week`;
  const dek = buildDek(props);
  const ctaUrl = withUtm("https://askarthur.au/app/threats", EMAIL_UTM);

  return (
    <Html>
      <Head />
      <Preview>{dek}</Preview>
      <Body
        style={{
          backgroundColor: WHITE,
          fontFamily: SERIF,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            maxWidth: "640px",
            margin: "0 auto",
            padding: 0,
            width: "100%",
          }}
        >
          {/* ================= HEADER ================= */}
          <Section style={{ backgroundColor: NAVY, padding: "28px 36px" }}>
            <Row>
              <Column
                style={{
                  textAlign: "left" as const,
                  verticalAlign: "middle",
                }}
              >
                <Link
                  href="https://askarthur.au"
                  style={{ textDecoration: "none", color: WHITE }}
                >
                  <Text
                    style={{
                      margin: 0,
                      color: WHITE,
                      fontFamily: SERIF,
                      fontSize: "22px",
                      fontWeight: 700,
                      letterSpacing: "0.5px",
                      lineHeight: 1,
                    }}
                  >
                    Ask Arthur
                  </Text>
                </Link>
              </Column>
              <Column
                style={{
                  textAlign: "right" as const,
                  verticalAlign: "middle",
                }}
              >
                <Text
                  style={{
                    margin: 0,
                    color: WHITE,
                    fontFamily: SANS,
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "2px",
                    textTransform: "uppercase" as const,
                    opacity: 0.85,
                  }}
                >
                  Weekly Intel
                </Text>
              </Column>
            </Row>
          </Section>

          {/* ================= CONTENT ================= */}
          <Section
            style={{ backgroundColor: WHITE, padding: "32px 36px 36px" }}
          >
            {/* Issue meta */}
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
              Briefing · {humaniseDate(weekStart)} – {humaniseDate(weekEnd)}
            </Text>

            {/* H1 — top emerging theme or fallback */}
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
              {headline}
            </Heading>

            {/* Dek — one tight line, replaces verbose lead-narrative block */}
            <Text
              style={{
                margin: "12px 0 0 0",
                padding: 0,
                fontFamily: SERIF,
                fontSize: "16px",
                lineHeight: "24px",
                color: NAVY,
                fontWeight: 400,
                opacity: 0.85,
              }}
            >
              {dek}
            </Text>

            {/* Stats card (moved up — scannable signal at the top) */}
            <div style={{ paddingTop: "24px", paddingBottom: "8px" }}>
              <Section
                style={{
                  backgroundColor: SURFACE_TINT,
                  border: `1px solid ${DIVIDER}`,
                  borderRadius: "10px",
                  padding: "24px 20px",
                }}
              >
                <Row>
                  <Column
                    style={{ width: "33%", textAlign: "center" as const }}
                  >
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SERIF,
                        fontSize: "32px",
                        lineHeight: "36px",
                        fontWeight: 600,
                        color: NAVY,
                      }}
                    >
                      {totalPostsClassified}
                    </Text>
                    <Text
                      style={{
                        margin: "4px 0 0 0",
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
                      Posts analysed
                    </Text>
                  </Column>
                  <Column
                    style={{ width: "34%", textAlign: "center" as const }}
                  >
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SERIF,
                        fontSize: "32px",
                        lineHeight: "36px",
                        fontWeight: 600,
                        color: NAVY,
                      }}
                    >
                      {emergingThemes.length}
                    </Text>
                    <Text
                      style={{
                        margin: "4px 0 0 0",
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
                      Emerging
                    </Text>
                  </Column>
                  <Column
                    style={{ width: "33%", textAlign: "center" as const }}
                  >
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily: SERIF,
                        fontSize: "32px",
                        lineHeight: "36px",
                        fontWeight: 600,
                        color: NAVY,
                      }}
                    >
                      {topBrands.length}
                    </Text>
                    <Text
                      style={{
                        margin: "4px 0 0 0",
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
                      Brands flagged
                    </Text>
                  </Column>
                </Row>
              </Section>
            </div>

            {/* Emerging themes section — titles link to per-theme pages */}
            {emergingThemes.length > 0 && (
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
                  Emerging this week
                </Heading>
                <div style={{ paddingTop: "16px" }}>
                  {emergingThemes.map((theme, i) => (
                    <div
                      key={theme.id}
                      style={{
                        marginTop: i === 0 ? 0 : "20px",
                        paddingBottom:
                          i === emergingThemes.length - 1 ? 0 : "16px",
                        borderBottom:
                          i === emergingThemes.length - 1
                            ? "none"
                            : `1px solid ${DIVIDER}`,
                      }}
                    >
                      <Text
                        style={{
                          margin: 0,
                          padding: 0,
                          fontFamily: SERIF,
                          fontSize: "17px",
                          lineHeight: "24px",
                          fontWeight: 600,
                          color: NAVY,
                        }}
                      >
                        {i + 1}.{" "}
                        {themeHref(theme) ? (
                          <Link
                            href={themeHref(theme) as string}
                            style={{
                              color: NAVY,
                              textDecoration: "underline",
                              textUnderlineOffset: "3px",
                            }}
                          >
                            {theme.title} ↗
                          </Link>
                        ) : (
                          <span>{theme.title}</span>
                        )}
                        {theme.signalLabel && (
                          <span
                            style={{
                              fontFamily: SANS,
                              fontSize: "10px",
                              fontWeight: 700,
                              letterSpacing: "1px",
                              textTransform: "uppercase" as const,
                              color: WHITE,
                              backgroundColor: NAVY,
                              borderRadius: "4px",
                              padding: "2px 6px",
                              marginLeft: "8px",
                              // inline-block so Outlook/Word honours the padding
                              // + background box rather than clipping it.
                              display: "inline-block",
                              whiteSpace: "nowrap" as const,
                            }}
                          >
                            {theme.signalLabel}
                          </span>
                        )}
                      </Text>
                      {theme.narrative && (
                        <Text
                          style={{
                            margin: "6px 0 0 0",
                            padding: 0,
                            fontFamily: SERIF,
                            fontSize: "15px",
                            lineHeight: "23px",
                            color: NAVY,
                            fontWeight: 400,
                            opacity: 0.85,
                          }}
                        >
                          {theme.narrative}
                        </Text>
                      )}
                      <Text
                        style={{
                          margin: "8px 0 0 0",
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
                        {theme.memberCount}{" "}
                        {theme.memberCount === 1 ? "report" : "reports"} this week
                        {theme.representativeBrands.length > 0 && (
                          <>
                            {" · "}
                            {theme.representativeBrands.slice(0, 3).join(" · ")}
                          </>
                        )}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Brand watchlist sentence */}
            {topBrands.length > 0 && (
              <div style={{ paddingTop: "32px" }}>
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
                  Brands impersonated
                </Heading>
                <Text
                  style={{
                    margin: "12px 0 0 0",
                    padding: 0,
                    fontFamily: SERIF,
                    fontSize: "16px",
                    lineHeight: "26px",
                    color: NAVY,
                    fontWeight: 400,
                  }}
                >
                  {topBrands
                    .map((b) => `${b.brand} (×${b.mentionCount})`)
                    .join(" · ")}
                </Text>
              </div>
            )}

            {/* Scam of the week — tip callout style */}
            {scamOfTheWeekQuote && (
              <div style={{ paddingTop: "32px" }}>
                <Section
                  style={{
                    backgroundColor: WHITE,
                    border: `1px solid ${NAVY}`,
                    borderRadius: "12px",
                    padding: "28px 28px 24px 28px",
                  }}
                >
                  <Text
                    style={{
                      margin: "0 0 10px 0",
                      padding: 0,
                      fontFamily: SANS,
                      fontSize: "11px",
                      lineHeight: "14px",
                      fontWeight: 700,
                      letterSpacing: "2px",
                      textTransform: "uppercase" as const,
                      color: NAVY,
                    }}
                  >
                    Scam of the week
                  </Text>
                  <Text
                    style={{
                      margin: "0 0 12px 0",
                      padding: 0,
                      fontFamily: SERIF,
                      fontSize: "17px",
                      lineHeight: "26px",
                      color: NAVY,
                      fontWeight: 400,
                      fontStyle: "italic" as const,
                    }}
                  >
                    &ldquo;{scamOfTheWeekQuote.text}&rdquo;
                  </Text>
                  <Text
                    style={{
                      margin: 0,
                      padding: 0,
                      fontFamily: SANS,
                      fontSize: "12px",
                      lineHeight: "16px",
                      color: NAVY,
                      fontWeight: 600,
                      opacity: 0.75,
                    }}
                  >
                    &mdash; {scamOfTheWeekQuote.speakerRole} report
                  </Text>
                </Section>
              </div>
            )}

            {/* Clone Watch — newly detected lookalike/impersonation domains
                this week (proprietary clone-watch stream). Renders only when
                non-empty so it vanishes cleanly on quiet weeks. Fake domains are
                rendered as PLAIN monospace text, never hyperlinked — we must
                never turn a scam domain into a clickable link in an email. */}
            {cloneWatch && cloneWatch.length > 0 && (
              <div style={{ paddingTop: "32px" }}>
                <Text
                  style={{
                    margin: "0 0 4px 0",
                    padding: 0,
                    fontFamily: SANS,
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "2px",
                    textTransform: "uppercase" as const,
                    color: NAVY,
                    opacity: 0.75,
                  }}
                >
                  Clone watch
                </Text>
                <Text
                  style={{
                    margin: "0 0 12px 0",
                    padding: 0,
                    fontFamily: SERIF,
                    fontSize: "15px",
                    lineHeight: "24px",
                    color: NAVY,
                    fontWeight: 400,
                  }}
                >
                  Lookalike sites we spotted this week. Don&rsquo;t enter your
                  details on these &mdash; check the address bar carefully.
                </Text>
                {cloneWatch.map((clone, i) => (
                  <div
                    key={`clone-${i}`}
                    style={{
                      marginBottom: i === cloneWatch.length - 1 ? 0 : "12px",
                      paddingBottom: i === cloneWatch.length - 1 ? 0 : "12px",
                      borderBottom:
                        i === cloneWatch.length - 1
                          ? "none"
                          : `1px solid ${DIVIDER}`,
                    }}
                  >
                    {clone.brand && (
                      <Text
                        style={{
                          margin: "0 0 4px 0",
                          padding: 0,
                          fontFamily: SANS,
                          fontSize: "14px",
                          lineHeight: "20px",
                          fontWeight: 700,
                          color: NAVY,
                        }}
                      >
                        {clone.brand}
                      </Text>
                    )}
                    <Text
                      style={{
                        margin: 0,
                        padding: 0,
                        fontFamily:
                          "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
                        fontSize: "13px",
                        lineHeight: "20px",
                        color: NAVY,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>Fake:</span>{" "}
                      {clone.fakeDomain}
                      {clone.realDomain ? (
                        <>
                          {"  "}
                          <span style={{ opacity: 0.55 }}>
                            (real: {clone.realDomain})
                          </span>
                        </>
                      ) : null}
                    </Text>
                  </div>
                ))}
              </div>
            )}

            {/* By the numbers */}
            {topCategories.length > 0 && (
              <div style={{ paddingTop: "32px" }}>
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
                  By the numbers
                </Heading>
                <Text
                  style={{
                    margin: "12px 0 0 0",
                    padding: 0,
                    fontFamily: SERIF,
                    fontSize: "16px",
                    lineHeight: "26px",
                    color: NAVY,
                    fontWeight: 400,
                  }}
                >
                  {topCategories
                    .map((c) => `${humaniseCategory(c.label)} (${c.count})`)
                    .join(" · ")}
                </Text>
              </div>
            )}

            {/* Regulator alerts — first-party narratives this week.
                Renders only when at least one alert was published in the
                7-day window so the section vanishes cleanly on quiet weeks. */}
            {regulatorAlerts && regulatorAlerts.length > 0 && (
              <div style={{ paddingTop: "32px" }}>
                <Text
                  style={{
                    margin: "0 0 12px 0",
                    padding: 0,
                    fontFamily: SANS,
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "2px",
                    textTransform: "uppercase" as const,
                    color: NAVY,
                    opacity: 0.75,
                  }}
                >
                  Regulator alerts this week
                </Text>
                <ul
                  style={{
                    margin: 0,
                    padding: "0 0 0 18px",
                    fontFamily: SERIF,
                    fontSize: "15px",
                    lineHeight: "24px",
                    color: NAVY,
                  }}
                >
                  {regulatorAlerts.map((alert, i) => (
                    <li key={`reg-${i}`} style={{ marginBottom: "6px" }}>
                      {alert.url ? (
                        <Link
                          href={alert.url}
                          style={{
                            color: NAVY,
                            textDecoration: "underline",
                            fontWeight: 500,
                          }}
                        >
                          {alert.title}
                        </Link>
                      ) : (
                        <span style={{ fontWeight: 500 }}>{alert.title}</span>
                      )}
                      <span
                        style={{
                          fontFamily: SANS,
                          fontSize: "12px",
                          color: NAVY,
                          opacity: 0.6,
                          marginLeft: "8px",
                        }}
                      >
                        — {alert.sourceLabel}
                        {alert.publishedAt
                          ? ` · ${humaniseDate(alert.publishedAt.slice(0, 10))}`
                          : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Primary CTA */}
            <div style={{ paddingTop: "32px" }}>
              <Button
                href={ctaUrl}
                style={{
                  backgroundColor: NAVY,
                  color: WHITE,
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
                View full intel on Ask Arthur
              </Button>
            </div>

            {/* Sign-off */}
            <Hr style={{ borderColor: DIVIDER, margin: "36px 0 28px 0" }} />
            <Text
              style={{
                margin: 0,
                padding: 0,
                fontFamily: SERIF,
                fontSize: "15px",
                lineHeight: "24px",
                color: NAVY,
                fontWeight: 400,
              }}
            >
              Stay safe out there,
              <br />
              <strong>The Ask Arthur team</strong>
            </Text>
          </Section>

          {/* ================= FOOTER ================= */}
          <Section style={{ backgroundColor: NAVY, padding: "32px 36px" }}>
            <Text
              style={{
                margin: "0 0 6px 0",
                padding: 0,
                fontFamily: SERIF,
                fontSize: "16px",
                fontWeight: 700,
                color: WHITE,
                lineHeight: "20px",
              }}
            >
              Ask Arthur
            </Text>
            <Text
              style={{
                margin: 0,
                padding: 0,
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "18px",
                color: NAVY_SOFT,
              }}
            >
              Australia&apos;s free AI scam checker · askarthur.au
            </Text>
            <Text
              style={{
                margin: "20px 0 0 0",
                padding: 0,
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "18px",
                color: NAVY_SOFT,
              }}
            >
              Ask Arthur · ABN 72 695 772 313 · Sydney, Australia
            </Text>
            <Text
              style={{
                margin: "8px 0 0 0",
                padding: 0,
                fontFamily: SANS,
                fontSize: "12px",
                lineHeight: "18px",
                color: NAVY_SOFT,
              }}
            >
              You&apos;re receiving this because you subscribed to Ask
              Arthur&apos;s weekly intel.
              <br />
              <Link
                href="https://askarthur.au/unsubscribe"
                style={{ color: NAVY_SOFT, textDecoration: "underline" }}
              >
                Unsubscribe
              </Link>
              {" · "}
              <Link
                href="https://askarthur.au"
                style={{ color: NAVY_SOFT, textDecoration: "underline" }}
              >
                askarthur.au
              </Link>
            </Text>
            {/* Operator-only debug strip — pixel-tiny so it doesn't clutter
                the consumer footer when subscribers exist. Useful for prompt
                regression triage when something looks off. */}
            <Text
              style={{
                margin: "16px 0 0 0",
                padding: 0,
                fontFamily: SANS,
                fontSize: "10px",
                lineHeight: "14px",
                color: NAVY_SOFT,
                opacity: 0.5,
              }}
            >
              {modelVersion} · {promptVersion}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

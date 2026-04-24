// React-PDF template for the Footprint report.
//
// Uses @react-pdf/renderer which is a server-side PDF engine — no browser
// required, runs inside an Inngest function. Template produces a single
// A4 page with BandBadge-style header, per-pillar grid, and footer.
//
// Typography + colours match the web report visual language so a printed
// PDF looks like a print version of the on-screen view. Tokens are
// inlined (react-pdf uses its own StyleSheet.create) because the package
// is framework-free — no Tailwind.
//
// Redaction rules mirror the web report:
//   - tier === 'teaser' → short explainer, no pillar detail (kept for
//     completeness even though PDF is paid-tier-only via the entitlement
//     check at the API route)
//   - Pillars with available=false render a "Coverage not available" row
//     instead of a score

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Footprint, PillarId, PillarResult } from "../types";

const COLOURS = {
  text: "#0F172A",
  mutedText: "#64748B",
  divider: "#E2E8F0",
  safe: "#15803D",
  safeBg: "#ECFDF5",
  caution: "#B45309",
  cautionBg: "#FFF8E1",
  high: "#C2410C",
  highBg: "#FFF3E0",
  critical: "#B91C1C",
  criticalBg: "#FEF2F2",
  neutral: "#6B7280",
  neutralBg: "#F3F4F6",
} as const;

const BAND_STYLE: Record<
  Footprint["band"],
  { fg: string; bg: string; label: string }
> = {
  safe: { fg: COLOURS.safe, bg: COLOURS.safeBg, label: "Safe" },
  caution: { fg: COLOURS.caution, bg: COLOURS.cautionBg, label: "Caution" },
  high: { fg: COLOURS.high, bg: COLOURS.highBg, label: "High risk" },
  critical: {
    fg: COLOURS.critical,
    bg: COLOURS.criticalBg,
    label: "Critical",
  },
};

const PILLAR_TITLES: Record<PillarId, string> = {
  scam_reports: "Community scam reports",
  breach: "Breach exposure",
  reputation: "Live fraud reputation",
  sim_swap: "Recent SIM swap",
  identity: "Number identity",
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    color: COLOURS.text,
    fontFamily: "Helvetica",
  },
  header: {
    marginBottom: 20,
    borderBottom: `1pt solid ${COLOURS.divider}`,
    paddingBottom: 12,
  },
  kicker: {
    fontSize: 8,
    color: COLOURS.mutedText,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: "Helvetica-Bold",
    color: COLOURS.text,
  },
  subtitle: {
    fontSize: 9,
    color: COLOURS.mutedText,
    marginTop: 2,
  },
  scoreBlock: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scorePill: {
    padding: 10,
    borderRadius: 8,
  },
  scoreNumber: {
    fontSize: 28,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.1,
  },
  scoreBand: {
    fontSize: 8,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: 3,
    fontFamily: "Helvetica-Bold",
  },
  explanation: {
    fontSize: 10,
    lineHeight: 1.45,
    color: COLOURS.text,
    maxWidth: "60%",
  },
  coverageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginBottom: 18,
  },
  coverageChip: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    fontSize: 8,
    color: COLOURS.text,
  },
  sectionTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    marginTop: 4,
    marginBottom: 8,
  },
  pillarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  pillarCard: {
    width: "48%",
    padding: 10,
    borderRadius: 6,
    border: `1pt solid ${COLOURS.divider}`,
  },
  pillarTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
  },
  pillarMeta: {
    fontSize: 8,
    color: COLOURS.mutedText,
    marginTop: 4,
  },
  pillarScoreRow: {
    marginTop: 6,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  pillarScore: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
  },
  footer: {
    marginTop: 24,
    paddingTop: 10,
    borderTop: `1pt solid ${COLOURS.divider}`,
    fontSize: 8,
    color: COLOURS.mutedText,
  },
});

interface Props {
  footprint: Footprint;
  /** Recipient email for the report header. */
  recipientEmail?: string;
}

export function FootprintPdf({ footprint, recipientEmail }: Props) {
  const band = BAND_STYLE[footprint.band];

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.kicker}>Phone Footprint report</Text>
          <Text style={styles.title}>{footprint.msisdn_e164}</Text>
          <Text style={styles.subtitle}>
            Generated {new Date(footprint.generated_at).toLocaleString("en-AU")}
            {recipientEmail ? ` · for ${recipientEmail}` : ""}
          </Text>

          <View style={styles.scoreBlock}>
            <View style={[styles.scorePill, { backgroundColor: band.bg }]}>
              <Text style={[styles.scoreBand, { color: band.fg }]}>
                {band.label}
              </Text>
              <Text style={[styles.scoreNumber, { color: band.fg }]}>
                {footprint.composite_score}
                <Text style={{ fontSize: 12 }}> / 100</Text>
              </Text>
            </View>
            {footprint.explanation ? (
              <Text style={styles.explanation}>{footprint.explanation}</Text>
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Data source coverage</Text>
        <View style={styles.coverageRow}>
          {Object.entries(footprint.coverage).map(([k, v]) => (
            <View
              key={k}
              style={[
                styles.coverageChip,
                { backgroundColor: coverageBg(v as string) },
              ]}
            >
              <Text>
                {coverageLabel(k)}: {String(v)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Signal breakdown</Text>
        <View style={styles.pillarGrid}>
          {(Object.keys(PILLAR_TITLES) as PillarId[]).map((id) => {
            const p = footprint.pillars[id];
            return <PillarCard key={id} id={id} pillar={p} tier={footprint.tier} />;
          })}
        </View>

        <View style={styles.footer}>
          <Text>
            Sources used:{" "}
            {footprint.providers_used.length > 0
              ? footprint.providers_used.join(", ")
              : "none"}
          </Text>
          <Text>
            Snapshot expires{" "}
            {new Date(footprint.expires_at).toLocaleDateString("en-AU")}. This
            report is generated from aggregate signals and describes
            data-source findings, not the individual associated with the
            number.
          </Text>
          <Text style={{ marginTop: 6 }}>Ask Arthur · askarthur.au</Text>
        </View>
      </Page>
    </Document>
  );
}

function PillarCard({
  id,
  pillar,
  tier,
}: {
  id: PillarId;
  pillar: PillarResult;
  tier: Footprint["tier"];
}) {
  const title = PILLAR_TITLES[id];
  if (!pillar.available) {
    return (
      <View style={[styles.pillarCard, { backgroundColor: COLOURS.neutralBg }]}>
        <Text style={styles.pillarTitle}>{title}</Text>
        <Text style={styles.pillarMeta}>Coverage not available</Text>
      </View>
    );
  }
  if (tier === "teaser") {
    return (
      <View style={styles.pillarCard}>
        <Text style={styles.pillarTitle}>{title}</Text>
        <Text style={styles.pillarMeta}>
          {pillar.score > 0 ? "Signal detected" : "No signal"}
        </Text>
      </View>
    );
  }
  return (
    <View style={styles.pillarCard}>
      <Text style={styles.pillarTitle}>{title}</Text>
      <View style={styles.pillarScoreRow}>
        <Text style={styles.pillarScore}>{pillar.score}</Text>
        <Text style={{ fontSize: 8, color: COLOURS.mutedText }}>/ 100</Text>
        <Text
          style={{
            fontSize: 8,
            color: COLOURS.mutedText,
            marginLeft: 8,
          }}
        >
          Confidence {Math.round(pillar.confidence * 100)}%
        </Text>
      </View>
    </View>
  );
}

function coverageBg(status: string): string {
  switch (status) {
    case "live":
      return COLOURS.safeBg;
    case "pending":
      return COLOURS.cautionBg;
    case "degraded":
      return COLOURS.highBg;
    case "fallback":
      return "#EFF6FF";
    default:
      return COLOURS.neutralBg;
  }
}

function coverageLabel(key: string): string {
  switch (key) {
    case "internal":
      return "Ask Arthur DB";
    case "twilio":
      return "Twilio";
    case "ipqs":
      return "IPQS";
    case "vonage":
      return "Vonage";
    case "leakcheck":
      return "LeakCheck";
    default:
      return key;
  }
}

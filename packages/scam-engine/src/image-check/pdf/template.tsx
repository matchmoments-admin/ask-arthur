// React-PDF template for the image-check evidence report (image-check v2
// PR 5, ADR-0022). One A4 page framed for attaching to a ReportCyber /
// eSafety report: check reference, timestamps, image URL + SHA-256, detector
// scores + generator attribution, Content Credentials, vision summary,
// methodology disclaimer.
//
// Honesty guardrail applies here with extra force (this document may end up
// in an official report): confidences as percentages with hedged wording,
// never a binary FAKE/REAL claim.

import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export interface ImageCheckEvidence {
  checkRef: string;
  checkedAt: string; // ISO
  imageUrl: string | null;
  pageUrl: string | null;
  imageSha256: string | null;
  aiConfidence: number | null;
  deepfakeConfidence: number | null;
  generatorSource: string | null;
  generatorBreakdown: Array<{ class: string; score: number }> | null;
  contentCredentials: { present: boolean; format?: string } | null;
  visionSummary: string | null;
  impersonatedBrand: string | null;
  impersonatedCelebrity: string | null;
}

const C = {
  text: "#0F172A",
  muted: "#64748B",
  divider: "#E2E8F0",
  amber: "#B45309",
  panel: "#F8FAFC",
} as const;

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, color: C.text, fontFamily: "Helvetica" },
  brand: { fontSize: 9, color: C.muted, letterSpacing: 1, marginBottom: 4 },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  ref: { fontSize: 11, color: C.amber, fontFamily: "Helvetica-Bold", marginBottom: 12 },
  section: { marginTop: 12 },
  heading: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  row: { flexDirection: "row", marginBottom: 3 },
  label: { width: 130, color: C.muted },
  value: { flex: 1 },
  mono: { fontFamily: "Courier", fontSize: 8 },
  panel: {
    backgroundColor: C.panel,
    borderRadius: 4,
    padding: 8,
    marginTop: 4,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: C.divider, marginVertical: 10 },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    fontSize: 8,
    color: C.muted,
  },
});

function pct(v: number | null): string {
  if (v === null || v === undefined) return "not assessed";
  return `${Math.round(v * 100)}%`;
}

export function ImageCheckEvidencePdf({ evidence }: { evidence: ImageCheckEvidence }) {
  const e = evidence;
  return (
    <Document
      title={`Ask Arthur image-check evidence ${e.checkRef}`}
      author="Ask Arthur (askarthur.au)"
    >
      <Page size="A4" style={styles.page}>
        <Text style={styles.brand}>ASK ARTHUR — askarthur.au</Text>
        <Text style={styles.title}>Image Check Evidence Report</Text>
        <Text style={styles.ref}>Reference: {e.checkRef}</Text>

        <View style={styles.section}>
          <Text style={styles.heading}>Checked item</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Checked at (UTC)</Text>
            <Text style={styles.value}>{e.checkedAt}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Image URL</Text>
            <Text style={[styles.value, styles.mono]}>{e.imageUrl ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Found on page</Text>
            <Text style={[styles.value, styles.mono]}>{e.pageUrl ?? "—"}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Image SHA-256</Text>
            <Text style={[styles.value, styles.mono]}>
              {e.imageSha256 ?? "not captured (image bytes were unavailable at check time)"}
            </Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.heading}>Detection results (probabilistic)</Text>
          <View style={styles.row}>
            <Text style={styles.label}>AI-generation score</Text>
            <Text style={styles.value}>{pct(e.aiConfidence)} likelihood of AI generation</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Deepfake score</Text>
            <Text style={styles.value}>{pct(e.deepfakeConfidence)} likelihood of face manipulation</Text>
          </View>
          {e.generatorBreakdown && e.generatorBreakdown.length > 0 ? (
            <View style={styles.row}>
              <Text style={styles.label}>Generator attribution</Text>
              <Text style={styles.value}>
                {e.generatorBreakdown
                  .map((g) => `${g.class} (${Math.round(g.score * 100)}%)`)
                  .join(", ")}
              </Text>
            </View>
          ) : e.generatorSource ? (
            <View style={styles.row}>
              <Text style={styles.label}>Generator attribution</Text>
              <Text style={styles.value}>{e.generatorSource}</Text>
            </View>
          ) : null}
          <View style={styles.row}>
            <Text style={styles.label}>Content Credentials</Text>
            <Text style={styles.value}>
              {e.contentCredentials === null
                ? "not assessed (image bytes unavailable)"
                : e.contentCredentials.present
                  ? `C2PA manifest present in ${e.contentCredentials.format ?? "image"} container (issuer not cryptographically verified)`
                  : "no C2PA manifest detected"}
            </Text>
          </View>
        </View>

        {(e.visionSummary || e.impersonatedBrand || e.impersonatedCelebrity) && (
          <View style={styles.section}>
            <Text style={styles.heading}>Content assessment (AI-assisted)</Text>
            {e.visionSummary ? (
              <View style={styles.panel}>
                <Text>{e.visionSummary}</Text>
              </View>
            ) : null}
            {e.impersonatedBrand ? (
              <View style={[styles.row, { marginTop: 4 }]}>
                <Text style={styles.label}>Possible impersonation</Text>
                <Text style={styles.value}>{e.impersonatedBrand}</Text>
              </View>
            ) : null}
            {e.impersonatedCelebrity ? (
              <View style={styles.row}>
                <Text style={styles.label}>Monitored-person match</Text>
                <Text style={styles.value}>{e.impersonatedCelebrity}</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.heading}>Methodology & limitations</Text>
          <Text>
            Scores are produced by automated classifiers (Hive AI image
            detection; Claude vision for content assessment) at the time of
            the check. They indicate that the image shares characteristics
            with AI-generated or manipulated content — they are probabilistic
            signals, not conclusive findings, and this document is not a
            forensic certification. The image itself is not retained by Ask
            Arthur; the SHA-256 above allows a party holding a copy of the
            image to verify it is the file that was assessed. Verify this
            reference at askarthur.au/image-check/{e.checkRef}.
          </Text>
        </View>

        <Text style={styles.footer}>
          Generated by Ask Arthur (askarthur.au) — Australian scam detection.
          Suitable for attaching to ReportCyber (cyber.gov.au) or eSafety
          (esafety.gov.au) reports. Reference {e.checkRef}.
        </Text>
      </Page>
    </Document>
  );
}

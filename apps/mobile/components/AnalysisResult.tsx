import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Colors } from "@/constants/colors";
import { VerdictBadge } from "./VerdictBadge";
import type { AnalysisResult as AnalysisResultType } from "@askarthur/types";

interface AnalysisResultProps {
  result: AnalysisResultType;
}

export function AnalysisResultView({ result }: AnalysisResultProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.badgeContainer}>
        <VerdictBadge verdict={result.verdict} confidence={result.confidence} />
      </View>

      <Text style={styles.summary}>{result.summary}</Text>

      {result.redFlags.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Red Flags</Text>
          {result.redFlags.map((flag, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>{"\u2022"}</Text>
              <Text style={styles.listText}>{flag}</Text>
            </View>
          ))}
        </View>
      )}

      {result.nextSteps.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What to Do</Text>
          {result.nextSteps.map((step, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>{"\u2022"}</Text>
              <Text style={styles.listText}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      {result.scamType && result.scamType !== "none" && (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>Scam Type:</Text>
          <Text style={styles.metaValue}>{result.scamType}</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  badgeContainer: {
    alignItems: "center",
  },
  summary: {
    fontSize: 16,
    lineHeight: 24,
    color: Colors.text,
  },
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text,
  },
  listItem: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 4,
  },
  bullet: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 22,
  },
  listText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    color: Colors.text,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  metaLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  metaValue: {
    fontSize: 14,
    color: Colors.text,
  },
});

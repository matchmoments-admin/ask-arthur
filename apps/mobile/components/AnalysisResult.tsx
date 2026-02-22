import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";
import { VerdictBadge } from "./VerdictBadge";
import type { AnalysisResult as AnalysisResultType } from "@askarthur/types";

interface AnalysisResultProps {
  result: AnalysisResultType;
  scrollable?: boolean;
}

export function AnalysisResultView({ result, scrollable = true }: AnalysisResultProps) {
  const Container = scrollable ? ScrollView : View;
  const containerProps = scrollable
    ? { style: styles.container, contentContainerStyle: styles.content }
    : { style: [styles.container, styles.content] };

  return (
    <Container {...containerProps}>
      <View style={styles.badgeContainer}>
        <VerdictBadge verdict={result.verdict} confidence={result.confidence} />
      </View>

      <View style={styles.card}>
        <Text style={styles.summary}>{result.summary}</Text>
      </View>

      {result.redFlags.length > 0 && (
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="flag" size={18} color={Colors.highRisk} />
            <Text style={styles.sectionTitle}>Red Flags</Text>
          </View>
          {result.redFlags.map((flag, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>{"\u2022"}</Text>
              <Text style={styles.listText}>{flag}</Text>
            </View>
          ))}
        </View>
      )}

      {result.nextSteps.length > 0 && (
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="arrow-forward-circle" size={18} color={Colors.primary} />
            <Text style={styles.sectionTitle}>What to Do</Text>
          </View>
          {result.nextSteps.map((step, i) => (
            <View key={i} style={styles.listItem}>
              <Text style={styles.bullet}>{"\u2022"}</Text>
              <Text style={styles.listText}>{step}</Text>
            </View>
          ))}
        </View>
      )}

      {result.scamType && result.scamType !== "none" && (
        <View style={styles.metaCard}>
          <Text style={styles.metaLabel}>Scam Type</Text>
          <Text style={styles.metaValue}>{result.scamType}</Text>
        </View>
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  badgeContainer: {
    alignItems: "center",
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summary: {
    fontSize: 16,
    lineHeight: 24,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: Fonts.bold,
    color: Colors.navy,
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
    fontFamily: Fonts.regular,
  },
  listText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  metaCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  metaLabel: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Colors.textSecondary,
  },
  metaValue: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Colors.navy,
  },
});

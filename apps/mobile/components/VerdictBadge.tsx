import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { VerdictColors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";
import type { Verdict } from "@askarthur/types";

const VERDICT_ICON: Record<Verdict, string> = {
  SAFE: "checkmark-circle",
  SUSPICIOUS: "alert-circle",
  HIGH_RISK: "close-circle",
};

const VERDICT_LABEL: Record<Verdict, string> = {
  SAFE: "Safe",
  SUSPICIOUS: "Suspicious",
  HIGH_RISK: "High Risk",
};

interface VerdictBadgeProps {
  verdict: Verdict;
  confidence: number;
}

export function VerdictBadge({ verdict, confidence }: VerdictBadgeProps) {
  const colors = VerdictColors[verdict];
  const percentage = Math.round(confidence * 100);

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.text }]}>
      <Ionicons name={VERDICT_ICON[verdict] as any} size={24} color={colors.text} />
      <Text style={[styles.label, { color: colors.text }]}>
        {VERDICT_LABEL[verdict]}
      </Text>
      <Text style={[styles.confidence, { color: colors.text }]}>
        {percentage}%
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    gap: 8,
  },
  label: {
    fontSize: 18,
    fontFamily: Fonts.bold,
  },
  confidence: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    opacity: 0.8,
  },
});

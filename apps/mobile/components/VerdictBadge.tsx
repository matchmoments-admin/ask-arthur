import { View, Text, StyleSheet } from "react-native";
import { VerdictColors } from "@/constants/colors";
import type { Verdict } from "@askarthur/types";

const VERDICT_EMOJI: Record<Verdict, string> = {
  SAFE: "\u2705",
  SUSPICIOUS: "\u26a0\ufe0f",
  HIGH_RISK: "\ud83d\udea8",
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
      <Text style={[styles.emoji]}>{VERDICT_EMOJI[verdict]}</Text>
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
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  emoji: {
    fontSize: 20,
  },
  label: {
    fontSize: 18,
    fontWeight: "700",
  },
  confidence: {
    fontSize: 14,
    fontWeight: "500",
    opacity: 0.8,
  },
});

import { View, Text, StyleSheet } from "react-native";
import { CheckCircle, CircleAlert, XCircle } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { VerdictColors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";
import type { Verdict } from "@askarthur/types";

const VERDICT_ICON: Record<Verdict, LucideIcon> = {
  SAFE: CheckCircle,
  SUSPICIOUS: CircleAlert,
  HIGH_RISK: XCircle,
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
  const Icon = VERDICT_ICON[verdict];

  return (
    <View style={[styles.badge, { backgroundColor: colors.bg, borderColor: colors.text }]}>
      <Icon size={24} color={colors.text} />
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

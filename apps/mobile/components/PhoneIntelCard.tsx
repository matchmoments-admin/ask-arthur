import { View, Text, StyleSheet } from "react-native";
import { Phone, Smartphone, Cpu, Globe, User, CircleAlert } from "lucide-react-native";
import { Colors, VerdictColors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";
import type { PhoneLookupResult, PhoneRiskLevel } from "@askarthur/types";

interface PhoneIntelCardProps {
  lookup: PhoneLookupResult;
}

const RISK_COLORS: Record<PhoneRiskLevel, string> = {
  LOW: "#388E3C",
  MEDIUM: "#F57C00",
  HIGH: "#E65100",
  CRITICAL: "#D32F2F",
};

const RISK_BG: Record<PhoneRiskLevel, string> = {
  LOW: "#ECFDF5",
  MEDIUM: "#FFF8E1",
  HIGH: "#FFF3E0",
  CRITICAL: "#FEF2F2",
};

function formatRiskFlag(flag: string): string {
  const labels: Record<string, string> = {
    voip: "VoIP number \u2014 internet-based, not tied to a physical line",
    invalid_number: "Invalid phone number format",
    non_au_origin: "Number originates outside Australia",
    unknown_carrier: "Carrier information unavailable",
    no_registered_name: "No registered caller name",
    lookup_failed: "Phone number lookup could not be completed",
  };
  return labels[flag] || flag;
}

function formatLineType(lineType: string | null): string {
  if (!lineType) return "Unknown";
  const labels: Record<string, string> = {
    mobile: "Mobile",
    landline: "Landline",
    nonFixedVoip: "VoIP",
    fixedVoip: "Fixed VoIP",
    tollFree: "Toll Free",
    personal: "Personal",
  };
  return labels[lineType] || lineType;
}

export function PhoneIntelCard({ lookup }: PhoneIntelCardProps) {
  const color = RISK_COLORS[lookup.riskLevel];
  const bg = RISK_BG[lookup.riskLevel];
  const warningFlags = lookup.riskFlags.filter((f) => f !== "lookup_failed");

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <Phone size={18} color={Colors.navy} />
        <Text style={styles.headerText}>Phone Risk Report Card</Text>
      </View>

      {/* Risk Score */}
      <View style={styles.scoreSection}>
        <View style={styles.scoreRow}>
          <Text style={styles.scoreLabel}>Risk Score</Text>
          <Text style={[styles.scoreValue, { color }]}>{lookup.riskScore}/100</Text>
        </View>
        <View style={styles.barBackground}>
          <View style={[styles.barFill, { width: `${lookup.riskScore}%`, backgroundColor: color }]} />
        </View>
        <View style={[styles.badge, { backgroundColor: bg }]}>
          <Text style={[styles.badgeText, { color }]}>{lookup.riskLevel}</Text>
        </View>
      </View>

      {/* Signal Grid (2x2) */}
      <View style={styles.grid}>
        <View style={styles.gridCell}>
          <Smartphone size={20} color={Colors.textSecondary} />
          <Text style={styles.cellLabel}>Line Type</Text>
          <Text style={styles.cellValue}>{formatLineType(lookup.lineType)}</Text>
        </View>
        <View style={styles.gridCell}>
          <Cpu size={20} color={Colors.textSecondary} />
          <Text style={styles.cellLabel}>Carrier</Text>
          <Text style={styles.cellValue} numberOfLines={1}>{lookup.carrier || "Unknown"}</Text>
        </View>
        <View style={styles.gridCell}>
          <Globe size={20} color={Colors.textSecondary} />
          <Text style={styles.cellLabel}>Country</Text>
          <Text style={styles.cellValue}>{lookup.countryCode || "Unknown"}</Text>
        </View>
        <View style={styles.gridCell}>
          <User size={20} color={Colors.textSecondary} />
          <Text style={styles.cellLabel}>Caller</Text>
          <Text style={styles.cellValue} numberOfLines={1}>{lookup.callerName || "Not Reg."}</Text>
        </View>
      </View>

      {/* Warning Flags */}
      {warningFlags.length > 0 && (
        <View style={styles.warnings}>
          {warningFlags.map((flag, i) => (
            <View key={i} style={styles.warningRow}>
              <CircleAlert size={16} color="#F57C00" />
              <Text style={styles.warningText}>{formatRiskFlag(flag)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Attribution */}
      <Text style={styles.attribution}>Powered by Twilio Lookup</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#F8FAFC",
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerText: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    color: Colors.navy,
  },
  scoreSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
  },
  scoreRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  scoreLabel: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Colors.navy,
  },
  scoreValue: {
    fontSize: 14,
    fontFamily: Fonts.bold,
  },
  barBackground: {
    height: 10,
    backgroundColor: "#F1F5F9",
    borderRadius: 5,
    overflow: "hidden",
  },
  barFill: {
    height: 10,
    borderRadius: 5,
  },
  badge: {
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    fontFamily: Fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  gridCell: {
    width: "47%",
    backgroundColor: "#F8FAFC",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    gap: 4,
  },
  cellLabel: {
    fontSize: 9,
    fontFamily: Fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: "#94A3B8",
  },
  cellValue: {
    fontSize: 13,
    fontFamily: Fonts.semiBold,
    color: Colors.navy,
    textAlign: "center",
  },
  warnings: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 12,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.text,
    lineHeight: 20,
  },
  attribution: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    fontSize: 11,
    fontFamily: Fonts.regular,
    color: "#CBD5E1",
  },
});

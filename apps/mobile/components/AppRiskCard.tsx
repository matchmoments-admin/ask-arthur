import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { CircleAlert, TriangleAlert, CheckCircle, XCircle, ChevronUp, ChevronDown } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";
import type { AppScanResult, RiskLevel } from "@/modules/app-scanner";

const RISK_CONFIG: Record<RiskLevel, { color: string; bg: string; icon: LucideIcon; label: string }> = {
  red: { color: "#D32F2F", bg: "#FEF2F2", icon: CircleAlert, label: "High Risk" },
  yellow: { color: "#F57C00", bg: "#FFF8E1", icon: TriangleAlert, label: "Caution" },
  green: { color: "#388E3C", bg: "#ECFDF5", icon: CheckCircle, label: "Low Risk" },
};

/** Plain-language labels for common Android permissions */
const PERMISSION_LABELS: Record<string, string> = {
  "android.permission.READ_SMS": "Read text messages",
  "android.permission.RECEIVE_SMS": "Receive text messages",
  "android.permission.SEND_SMS": "Send text messages",
  "android.permission.READ_CONTACTS": "Read contacts",
  "android.permission.CAMERA": "Use camera",
  "android.permission.RECORD_AUDIO": "Record audio",
  "android.permission.ACCESS_FINE_LOCATION": "Precise location",
  "android.permission.ACCESS_BACKGROUND_LOCATION": "Background location",
  "android.permission.READ_CALL_LOG": "Read call history",
  "android.permission.READ_PHONE_STATE": "Read phone state",
  "android.permission.REQUEST_INSTALL_PACKAGES": "Install other apps",
  "android.permission.SYSTEM_ALERT_WINDOW": "Draw over other apps",
  "android.permission.READ_EXTERNAL_STORAGE": "Read files",
  "android.permission.WRITE_EXTERNAL_STORAGE": "Write files",
  "android.permission.READ_MEDIA_IMAGES": "Access photos",
  "android.permission.READ_MEDIA_VIDEO": "Access videos",
};

function getPermissionLabel(name: string): string {
  return PERMISSION_LABELS[name] ?? name.split(".").pop() ?? name;
}

interface AppRiskCardProps {
  app: AppScanResult;
}

export function AppRiskCard({ app }: AppRiskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const config = RISK_CONFIG[app.riskLevel];
  const grantedCount = app.dangerousPermissions.filter((p) => p.granted).length;

  return (
    <Pressable
      style={[styles.card, { borderLeftColor: config.color }]}
      onPress={() => setExpanded(!expanded)}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.appName} numberOfLines={1}>
            {app.appName}
          </Text>
          <Text style={styles.version}>v{app.versionName}</Text>
        </View>
        <View style={[styles.badge, { backgroundColor: config.bg }]}>
          <config.icon size={14} color={config.color} />
          <Text style={[styles.badgeText, { color: config.color }]}>
            {config.label}
          </Text>
        </View>
      </View>

      <Text style={styles.permCount}>
        {grantedCount} dangerous permission{grantedCount !== 1 ? "s" : ""} granted
      </Text>

      {app.riskReasons.length > 0 && (
        <View style={styles.reasons}>
          {app.riskReasons.slice(0, 3).map((reason, i) => (
            <Text key={i} style={styles.reasonText}>
              {"\u2022"} {reason}
            </Text>
          ))}
        </View>
      )}

      {expanded && app.dangerousPermissions.length > 0 && (
        <View style={styles.permList}>
          <Text style={styles.permListTitle}>Permissions</Text>
          {app.dangerousPermissions.map((perm, i) => (
            <View key={i} style={styles.permRow}>
              {perm.granted ? (
                <CheckCircle size={16} color={Colors.highRisk} />
              ) : (
                <XCircle size={16} color={Colors.textSecondary} />
              )}
              <Text style={styles.permName}>{getPermissionLabel(perm.name)}</Text>
              <Text style={styles.permStatus}>
                {perm.granted ? "Granted" : "Denied"}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.expandRow}>
        {expanded ? (
          <ChevronUp size={16} color={Colors.textSecondary} />
        ) : (
          <ChevronDown size={16} color={Colors.textSecondary} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 4,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  appName: {
    fontSize: 16,
    fontFamily: Fonts.semiBold,
    color: Colors.navy,
  },
  version: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: Fonts.semiBold,
  },
  permCount: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  reasons: {
    gap: 2,
  },
  reasonText: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  permList: {
    marginTop: 4,
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 10,
  },
  permListTitle: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Colors.navy,
    marginBottom: 2,
  },
  permRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  permName: {
    flex: 1,
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  permStatus: {
    fontSize: 12,
    fontFamily: Fonts.medium,
    color: Colors.textSecondary,
  },
  expandRow: {
    alignItems: "center",
    marginTop: -2,
  },
});

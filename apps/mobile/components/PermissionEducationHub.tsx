import { View, Text, Pressable, StyleSheet, Linking, Platform } from "react-native";
import { ShieldCheck, Settings, TriangleAlert, ExternalLink } from "lucide-react-native";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

/**
 * iOS fallback for the app scanner tab.
 * Explains how to audit permissions in iOS Settings and provides
 * links to known scam app databases.
 */
export function PermissionEducationHub() {
  const openSettings = () => {
    if (Platform.OS === "ios") {
      Linking.openURL("app-settings:");
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconRow}>
          <ShieldCheck size={32} color={Colors.primary} />
        </View>
        <Text style={styles.title}>App Permission Audit</Text>
        <Text style={styles.description}>
          iOS doesn't allow apps to scan other installed apps. You can review
          app permissions directly in your device Settings.
        </Text>
        <Pressable style={styles.settingsButton} onPress={openSettings}>
          <Settings size={18} color={Colors.white} />
          <Text style={styles.settingsButtonText}>Open Settings</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>How to Check App Permissions</Text>
        <Step number={1} text="Open Settings > Privacy & Security" />
        <Step number={2} text="Tap each category (Camera, Microphone, Location, etc.)" />
        <Step number={3} text="Review which apps have access and toggle off any you don't trust" />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Warning Signs</Text>
        <WarningItem text="Apps requesting SMS or call log access" />
        <WarningItem text="Flashlight apps needing camera + contacts" />
        <WarningItem text="Games requesting location + microphone" />
        <WarningItem text="Apps from unknown developers with broad permissions" />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Report Suspicious Apps</Text>
        <LinkItem
          label="Scamwatch (ACCC)"
          url="https://www.scamwatch.gov.au/report-a-scam"
        />
        <LinkItem
          label="ReportCyber (AFP)"
          url="https://www.cyber.gov.au/report-and-recover/report"
        />
      </View>
    </View>
  );
}

function Step({ number, text }: { number: number; text: string }) {
  return (
    <View style={styles.stepRow}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{number}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

function WarningItem({ text }: { text: string }) {
  return (
    <View style={styles.warningRow}>
      <TriangleAlert size={16} color={Colors.suspicious} />
      <Text style={styles.warningText}>{text}</Text>
    </View>
  );
}

function LinkItem({ label, url }: { label: string; url: string }) {
  return (
    <Pressable style={styles.linkRow} onPress={() => Linking.openURL(url)}>
      <ExternalLink size={16} color={Colors.primary} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  iconRow: {
    alignItems: "center",
  },
  title: {
    fontSize: 20,
    fontFamily: Fonts.bold,
    color: Colors.navy,
    textAlign: "center",
  },
  description: {
    fontSize: 15,
    fontFamily: Fonts.regular,
    color: Colors.text,
    textAlign: "center",
    lineHeight: 22,
  },
  settingsButton: {
    flexDirection: "row",
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  settingsButtonText: {
    color: Colors.white,
    fontSize: 15,
    fontFamily: Fonts.semiBold,
  },
  sectionTitle: {
    fontSize: 17,
    fontFamily: Fonts.bold,
    color: Colors.navy,
  },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumberText: {
    color: Colors.white,
    fontSize: 13,
    fontFamily: Fonts.bold,
  },
  stepText: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.text,
    lineHeight: 22,
  },
  warningRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  warningText: {
    flex: 1,
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.background,
    padding: 12,
    borderRadius: 8,
  },
  linkText: {
    fontSize: 14,
    fontFamily: Fonts.medium,
    color: Colors.primary,
  },
});

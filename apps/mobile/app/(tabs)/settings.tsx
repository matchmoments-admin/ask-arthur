import { View, Text, Pressable, StyleSheet, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Trash2, FileText, BookOpen, Globe, ChevronRight } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useScanHistory } from "@/hooks/useScanHistory";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

export default function SettingsScreen() {
  const { history, clear } = useScanHistory();

  const handleClearHistory = () => {
    Alert.alert(
      "Clear History",
      "Are you sure you want to clear all scan history?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear", style: "destructive", onPress: clear },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>History</Text>
          <Text style={styles.sectionMeta}>
            {history.length} scan{history.length !== 1 ? "s" : ""} saved locally
          </Text>
          <Pressable
            style={[styles.destructiveButton, history.length === 0 && styles.buttonDisabled]}
            onPress={handleClearHistory}
            disabled={history.length === 0}
          >
            <Trash2 size={18} color={Colors.error} />
            <Text style={styles.destructiveButtonText}>Clear Scan History</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>AI Disclosure</Text>
          <Text style={styles.disclosureText}>
            Ask Arthur uses Anthropic's Claude AI to analyse messages for scam
            indicators. Your message text is sent to the AI for analysis and is
            never stored or used for training. Images are processed in-memory
            and immediately discarded.
          </Text>
          <Text style={styles.disclosureText}>
            AI analysis may not be 100% accurate. Always exercise caution with
            suspicious messages and verify through official channels.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Privacy</Text>
          <Text style={styles.disclosureText}>
            {"\u2022"} Messages are analysed in real-time and never saved{"\n"}
            {"\u2022"} Personal information is automatically scrubbed before analysis{"\n"}
            {"\u2022"} App scan results stay entirely on your device{"\n"}
            {"\u2022"} No account or login required{"\n"}
            {"\u2022"} No tracking or analytics SDKs
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>About</Text>
          <SettingsLink icon={FileText} label="Privacy Policy" url="https://askarthur.au/privacy" />
          <SettingsLink icon={BookOpen} label="Terms of Service" url="https://askarthur.au/terms" />
          <SettingsLink icon={Globe} label="Website" url="https://askarthur.au" />
        </View>

        <Text style={styles.version}>Ask Arthur v1.0.0</Text>
      </View>
    </SafeAreaView>
  );
}

function SettingsLink({ icon: Icon, label, url }: { icon: LucideIcon; label: string; url: string }) {
  return (
    <Pressable style={styles.link} onPress={() => Linking.openURL(url)}>
      <View style={styles.linkLeft}>
        <Icon size={20} color={Colors.primary} />
        <Text style={styles.linkText}>{label}</Text>
      </View>
      <ChevronRight size={18} color={Colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
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
  sectionTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Colors.navy,
  },
  sectionMeta: {
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  disclosureText: {
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.text,
    lineHeight: 22,
  },
  destructiveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.errorBg,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  destructiveButtonText: {
    color: Colors.error,
    fontSize: 15,
    fontFamily: Fonts.semiBold,
  },
  link: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.background,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
  },
  linkLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  linkText: {
    fontSize: 15,
    fontFamily: Fonts.medium,
    color: Colors.text,
  },
  version: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: "auto",
  },
});

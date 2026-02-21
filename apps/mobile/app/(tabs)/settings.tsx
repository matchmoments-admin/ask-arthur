import { View, Text, Pressable, StyleSheet, Linking, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useScanHistory } from "@/hooks/useScanHistory";
import { Colors } from "@/constants/colors";

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
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>History</Text>
          <Text style={styles.sectionMeta}>
            {history.length} scan{history.length !== 1 ? "s" : ""} saved locally
          </Text>
          <Pressable
            style={[styles.destructiveButton, history.length === 0 && styles.buttonDisabled]}
            onPress={handleClearHistory}
            disabled={history.length === 0}
          >
            <Text style={styles.destructiveButtonText}>Clear Scan History</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <SettingsLink label="Privacy Policy" url="https://askarthur.au/privacy" />
          <SettingsLink label="Terms of Service" url="https://askarthur.au/terms" />
          <SettingsLink label="Website" url="https://askarthur.au" />
        </View>

        <Text style={styles.version}>Ask Arthur v1.0.0</Text>
      </View>
    </SafeAreaView>
  );
}

function SettingsLink({ label, url }: { label: string; url: string }) {
  return (
    <Pressable style={styles.link} onPress={() => Linking.openURL(url)}>
      <Text style={styles.linkText}>{label}</Text>
      <Text style={styles.arrow}>{"\u203a"}</Text>
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
    gap: 32,
  },
  section: {
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
  },
  sectionMeta: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  destructiveButton: {
    backgroundColor: Colors.surface,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.error,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  destructiveButtonText: {
    color: Colors.error,
    fontSize: 15,
    fontWeight: "600",
  },
  link: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
  },
  linkText: {
    fontSize: 15,
    color: Colors.text,
  },
  arrow: {
    fontSize: 20,
    color: Colors.textSecondary,
  },
  version: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: "auto",
  },
});

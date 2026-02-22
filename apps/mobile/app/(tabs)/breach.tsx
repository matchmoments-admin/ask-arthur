import { useState } from "react";
import { View, Text, TextInput, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Button } from "@/components/Button";
import { checkBreach, type BreachResult } from "@/lib/breach";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

export default function BreachScreen() {
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<BreachResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCheck = async () => {
    if (!email.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await checkBreach(email.trim());
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setEmail("");
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.headerCard}>
            <Ionicons name="shield-checkmark" size={32} color={Colors.primary} />
            <Text style={styles.title}>Data Breach Check</Text>
            <Text style={styles.description}>
              Check if your email has appeared in known data breaches. Powered by Have I Been Pwned.
            </Text>
          </View>

          <View style={styles.inputCard}>
            <Text style={styles.inputLabel}>Email address</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={Colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {!result && (
            <Button
              label="Check Breaches"
              onPress={handleCheck}
              disabled={!email.trim() || loading}
            />
          )}

          {result && !result.breached && (
            <View style={[styles.resultCard, styles.resultCardSafe]}>
              <View style={styles.resultHeader}>
                <Ionicons name="checkmark-circle" size={24} color={Colors.safe} />
                <Text style={[styles.resultTitle, { color: Colors.safe }]}>
                  No breaches found
                </Text>
              </View>
              <Text style={styles.resultText}>
                Great news! This email hasn't appeared in any known data breaches.
              </Text>
            </View>
          )}

          {result && result.breached && (
            <View style={[styles.resultCard, styles.resultCardRisk]}>
              <View style={styles.resultHeader}>
                <Ionicons name="warning" size={24} color={Colors.highRisk} />
                <Text style={[styles.resultTitle, { color: Colors.highRisk }]}>
                  Found in {result.breachCount} breach{result.breachCount !== 1 ? "es" : ""}
                </Text>
              </View>
              <Text style={styles.resultText}>
                This email was found in the following data breaches. Consider changing your passwords.
              </Text>

              {result.breaches.map((breach, i) => (
                <View key={i} style={styles.breachItem}>
                  <Text style={styles.breachName}>{breach.title}</Text>
                  <Text style={styles.breachMeta}>
                    {breach.domain} {"\u2022"} {breach.date}
                  </Text>
                  <Text style={styles.breachData}>
                    Exposed: {breach.dataTypes.slice(0, 5).join(", ")}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {result && (
            <Button label="Check Another" onPress={handleReset} />
          )}
        </ScrollView>
        {loading && <LoadingOverlay message="Checking breaches..." />}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  headerCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  title: {
    fontSize: 22,
    fontFamily: Fonts.bold,
    color: Colors.navy,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  inputCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputLabel: {
    fontSize: 14,
    fontFamily: Fonts.semiBold,
    color: Colors.navy,
  },
  input: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 14,
    fontSize: 16,
    fontFamily: Fonts.regular,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  errorCard: {
    backgroundColor: Colors.errorBg,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  errorText: {
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.error,
    textAlign: "center",
  },
  resultCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  resultCardSafe: {
    borderColor: Colors.safe,
    backgroundColor: Colors.safeBg,
  },
  resultCardRisk: {
    borderColor: Colors.highRisk,
    backgroundColor: Colors.highRiskBg,
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  resultTitle: {
    fontSize: 18,
    fontFamily: Fonts.bold,
  },
  resultText: {
    fontSize: 14,
    lineHeight: 22,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  breachItem: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 4,
  },
  breachName: {
    fontSize: 16,
    fontFamily: Fonts.semiBold,
    color: Colors.navy,
  },
  breachMeta: {
    fontSize: 12,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
  },
  breachData: {
    fontSize: 13,
    fontFamily: Fonts.regular,
    color: Colors.textSecondary,
    fontStyle: "italic",
  },
});

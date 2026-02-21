import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { checkBreach, type BreachResult } from "@/lib/breach";
import { Colors } from "@/constants/colors";

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
          <Text style={styles.title}>Data Breach Check</Text>
          <Text style={styles.description}>
            Check if your email has appeared in known data breaches. Powered by Have I Been Pwned.
          </Text>

          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="Enter your email address"
            placeholderTextColor={Colors.textSecondary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          {!result && (
            <Pressable
              style={[styles.button, !email.trim() && styles.buttonDisabled]}
              onPress={handleCheck}
              disabled={!email.trim() || loading}
            >
              <Text style={styles.buttonText}>Check Breaches</Text>
            </Pressable>
          )}

          {result && !result.breached && (
            <View style={[styles.resultCard, { borderColor: Colors.safe }]}>
              <Text style={[styles.resultTitle, { color: Colors.safe }]}>
                {"\u2705"} No breaches found
              </Text>
              <Text style={styles.resultText}>
                Great news! This email hasn't appeared in any known data breaches.
              </Text>
            </View>
          )}

          {result && result.breached && (
            <View style={[styles.resultCard, { borderColor: Colors.highRisk }]}>
              <Text style={[styles.resultTitle, { color: Colors.highRisk }]}>
                {"\ud83d\udea8"} Found in {result.breachCount} breach{result.breachCount !== 1 ? "es" : ""}
              </Text>
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
            <Pressable style={styles.button} onPress={handleReset}>
              <Text style={styles.buttonText}>Check Another</Text>
            </Pressable>
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
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.text,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
    color: Colors.textSecondary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  errorText: {
    fontSize: 14,
    color: Colors.error,
    textAlign: "center",
  },
  button: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "600",
  },
  resultCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    gap: 12,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  resultText: {
    fontSize: 14,
    lineHeight: 22,
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
    fontWeight: "600",
    color: Colors.text,
  },
  breachMeta: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  breachData: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontStyle: "italic",
  },
});

import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AnalysisResultView } from "@/components/AnalysisResult";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { useAnalysis } from "@/hooks/useAnalysis";
import { Colors } from "@/constants/colors";

export default function CheckScreen() {
  const { result, loading, error, analyze, reset } = useAnalysis();
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (!text.trim()) return;
    analyze(text.trim());
  };

  if (result) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <AnalysisResultView result={result} />
        <View style={styles.footer}>
          <Pressable
            style={styles.button}
            onPress={() => {
              reset();
              setText("");
            }}
          >
            <Text style={styles.buttonText}>Check Another</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.label}>
            Paste a suspicious message below
          </Text>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Paste the message, email, or SMS here..."
            placeholderTextColor={Colors.textSecondary}
            multiline
            textAlignVertical="top"
            maxLength={10000}
          />

          {error && <Text style={styles.errorText}>{error}</Text>}

          <Pressable
            style={[styles.button, !text.trim() && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={!text.trim() || loading}
          >
            <Text style={styles.buttonText}>Check for Scam</Text>
          </Pressable>
        </View>
        {loading && <LoadingOverlay />}
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
    flex: 1,
    padding: 16,
    gap: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 150,
  },
  errorText: {
    fontSize: 14,
    color: Colors.error,
    textAlign: "center",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
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
});

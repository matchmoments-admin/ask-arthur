import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AnalysisResultView } from "@/components/AnalysisResult";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { useAnalysis } from "@/hooks/useAnalysis";
import { API_URL } from "@/constants/config";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

export default function HomeScreen() {
  const router = useRouter();
  const { result, loading, error, analyze, reset } = useAnalysis();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [scamCount, setScamCount] = useState<number | null>(null);

  const fetchCount = useCallback(() => {
    fetch(`${API_URL}/api/stats`)
      .then((r) => r.json())
      .then((data) => setScamCount(data.totalChecks ?? data.count ?? 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  const handleSubmit = () => {
    if (!text.trim()) return;
    analyze(text.trim());
  };

  const handleReset = () => {
    reset();
    setText("");
    fetchCount();
  };

  const hasResult = !!result;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <SafeAreaView style={styles.flex} edges={["bottom"]}>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Hero */}
          <Text style={styles.heroHeading}>
            Got a suspicious message, email, or image?
          </Text>
          <Text style={styles.heroSubtitle}>
            Paste it here. Arthur will review it and report back to you.
          </Text>

          {/* Input container */}
          <View
            style={[
              styles.inputContainer,
              focused && styles.inputContainerFocused,
            ]}
          >
            <TextInput
              style={styles.textarea}
              value={text}
              onChangeText={setText}
              placeholder="Paste the message here..."
              placeholderTextColor={Colors.textSecondary}
              multiline
              textAlignVertical="top"
              maxLength={10000}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              editable={!loading && !hasResult}
            />
            <View style={styles.toolbar}>
              <Pressable style={styles.attachButton}>
                <Ionicons name="attach" size={22} color={Colors.textSecondary} />
              </Pressable>
              {hasResult ? (
                <Pressable style={styles.checkButton} onPress={handleReset}>
                  <Text style={styles.checkButtonText}>CHECK ANOTHER</Text>
                </Pressable>
              ) : (
                <Pressable
                  style={[
                    styles.checkButton,
                    (!text.trim() || loading) && styles.buttonDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={!text.trim() || loading}
                >
                  <Text style={styles.checkButtonText}>CHECK NOW</Text>
                </Pressable>
              )}
            </View>
          </View>

          {/* Error */}
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Privacy notice */}
          <View style={styles.privacyRow}>
            <Ionicons name="lock-closed" size={14} color={Colors.textSecondary} />
            <Ionicons name="eye-off" size={14} color={Colors.textSecondary} />
            <Text style={styles.privacyLabel}>WE NEVER STORE YOUR DATA</Text>
          </View>
          <Text style={styles.privacyDetail}>
            Your message is sent to our AI for analysis and is never saved or shared.
          </Text>

          {/* Analysis result */}
          {result && <AnalysisResultView result={result} scrollable={false} />}

          {/* Scam counter */}
          {scamCount !== null && (
            <View style={styles.counterContainer}>
              <Text style={styles.counterNumber}>
                {scamCount.toLocaleString()}
              </Text>
              <Text style={styles.counterLabel}>VERIFIED CHECKS</Text>
            </View>
          )}

          {/* Navigation buttons */}
          <View style={styles.navButtons}>
            <Pressable
              style={styles.navButton}
              onPress={() => router.push("/scan")}
            >
              <Text style={styles.navButtonText}>SCAN QR CODE</Text>
            </Pressable>
            <Pressable
              style={styles.navButton}
              onPress={() => router.push("/breach")}
            >
              <Text style={styles.navButtonText}>BREACH CHECK</Text>
            </Pressable>
            <Pressable
              style={styles.navButton}
              onPress={() => router.push("/settings")}
            >
              <Text style={styles.navButtonText}>SETTINGS</Text>
            </Pressable>
          </View>
        </ScrollView>

        {loading && <LoadingOverlay />}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 24,
    paddingTop: 32,
    gap: 0,
  },

  // Hero
  heroHeading: {
    fontSize: 28,
    fontFamily: Fonts.bold,
    color: Colors.navy,
    textAlign: "center",
    marginBottom: 12,
  },
  heroSubtitle: {
    fontSize: 17,
    fontFamily: Fonts.regular,
    color: Colors.text,
    textAlign: "center",
    marginBottom: 32,
  },

  // Input container
  inputContainer: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: Colors.border,
    overflow: "hidden",
    marginBottom: 16,
  },
  inputContainerFocused: {
    borderColor: Colors.navy,
  },
  textarea: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 17,
    fontFamily: Fonts.regular,
    color: Colors.navy,
    minHeight: 100,
  },
  toolbar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  attachButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  checkButton: {
    height: 44,
    paddingHorizontal: 24,
    backgroundColor: Colors.navy,
    borderRadius: 9999,
    justifyContent: "center",
    alignItems: "center",
  },
  checkButtonText: {
    color: Colors.textOnDark,
    fontSize: 13,
    fontFamily: Fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 3,
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  // Error
  errorCard: {
    backgroundColor: Colors.errorBg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.error,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 14,
    fontFamily: Fonts.regular,
    color: Colors.error,
    textAlign: "center",
  },

  // Privacy
  privacyRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginBottom: 4,
  },
  privacyLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 3,
  },
  privacyDetail: {
    fontSize: 11,
    fontFamily: Fonts.regular,
    color: "#94A3B8",
    textAlign: "center",
    marginBottom: 24,
  },

  // Counter
  counterContainer: {
    alignItems: "center",
    marginTop: 24,
    marginBottom: 24,
  },
  counterNumber: {
    fontSize: 18,
    fontFamily: Fonts.bold,
    color: Colors.navy,
  },
  counterLabel: {
    fontSize: 11,
    fontFamily: Fonts.bold,
    color: Colors.text,
    textTransform: "uppercase",
    letterSpacing: 3,
    marginTop: 4,
  },

  // Navigation buttons
  navButtons: {
    gap: 12,
  },
  navButton: {
    backgroundColor: Colors.navy,
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  navButtonText: {
    color: Colors.textOnDark,
    fontSize: 15,
    fontFamily: Fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 3,
  },
});

import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { XCircle, Paperclip, Lock, EyeOff } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { AnalysisResultView } from "@/components/AnalysisResult";
import { AIConsentModal } from "@/components/AIConsentModal";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Button } from "@/components/Button";
import { useAnalysis } from "@/hooks/useAnalysis";
import { useAIConsent } from "@/hooks/useAIConsent";
import { API_URL } from "@/constants/config";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

const MAX_IMAGES = 10;

export default function HomeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ sharedText?: string; sharedImages?: string }>();
  const { result, loading, error, analyze, reset } = useAnalysis();
  const { hasConsent, showModal, ensureConsent, acceptConsent, dismissModal } = useAIConsent();
  const [text, setText] = useState("");
  const [images, setImages] = useState<Array<{ base64: string; uri: string }>>([]);
  const [focused, setFocused] = useState(false);
  const [scamCount, setScamCount] = useState<number | null>(null);
  const sharedHandled = useRef(false);

  const fetchCount = useCallback(() => {
    fetch(`${API_URL}/api/stats`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => setScamCount(data.totalChecks ?? data.count ?? 0))
      .catch((err) => {
        console.warn("Failed to fetch stats:", err.message);
        setScamCount(null);
      });
  }, []);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Consume share intent data
  useEffect(() => {
    if (sharedHandled.current) return;

    const hasSharedText = params.sharedText && params.sharedText.length > 0;
    const hasSharedImages = params.sharedImages && params.sharedImages.length > 0;

    if (!hasSharedText && !hasSharedImages) return;

    sharedHandled.current = true;

    if (hasSharedText) {
      setText(params.sharedText!);
    }

    if (hasSharedImages) {
      // Load shared image URIs and convert to base64
      const imageUris: string[] = JSON.parse(params.sharedImages!);
      Promise.all(
        imageUris.slice(0, MAX_IMAGES).map(async (uri) => {
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          return { base64, uri };
        })
      ).then((loaded) => {
        setImages(loaded);
        // Auto-trigger analysis with shared content (gated by AI consent)
        const sharedText = params.sharedText ?? "";
        const triggerAnalysis = () =>
          analyze(
            sharedText,
            loaded.length > 0 ? "image" : "text",
            loaded.length > 0 ? loaded.map((i) => i.base64) : undefined,
          );
        ensureConsent(triggerAnalysis);
      }).catch(() => {
        // If image loading fails, just analyze the text
        if (hasSharedText) {
          const triggerAnalysis = () => analyze(params.sharedText!, "text");
          ensureConsent(triggerAnalysis);
        }
      });
    } else if (hasSharedText) {
      // Auto-trigger text analysis (gated by AI consent)
      const triggerAnalysis = () => analyze(params.sharedText!, "text");
      ensureConsent(triggerAnalysis);
    }
  }, [params.sharedText, params.sharedImages, analyze, ensureConsent]);

  const handleAttach = async () => {
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      Alert.alert("Limit reached", `You can attach up to ${MAX_IMAGES} images.`);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.7,
      base64: true,
    });

    if (result.canceled || !result.assets) return;

    const newImages = result.assets
      .filter((a) => a.base64)
      .map((a) => ({ base64: a.base64!, uri: a.uri }));

    setImages((prev) => [...prev, ...newImages].slice(0, MAX_IMAGES));
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const canSubmit = text.trim() || images.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const triggerAnalysis = () =>
      analyze(
        text.trim(),
        images.length > 0 ? "image" : "text",
        images.length > 0 ? images.map((i) => i.base64) : undefined,
      );
    ensureConsent(triggerAnalysis);
  };

  const handleReset = () => {
    reset();
    setText("");
    setImages([]);
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
            {images.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.imageStrip}
                contentContainerStyle={styles.imageStripContent}
              >
                {images.map((img, index) => (
                  <View key={index} style={styles.imageThumb}>
                    <Image source={{ uri: img.uri }} style={styles.thumbImage} />
                    {!loading && !hasResult && (
                      <Pressable
                        style={styles.removeButton}
                        onPress={() => removeImage(index)}
                        hitSlop={8}
                      >
                        <XCircle size={20} color={Colors.error} />
                      </Pressable>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.toolbar}>
              <Pressable
                style={styles.attachButton}
                onPress={handleAttach}
                disabled={loading || hasResult}
              >
                <Paperclip
                  size={22}
                  color={loading || hasResult ? Colors.border : Colors.textSecondary}
                />
              </Pressable>
              {hasResult ? (
                <Button variant="pill" label="CHECK ANOTHER" onPress={handleReset} />
              ) : (
                <Button
                  variant="pill"
                  label="CHECK NOW"
                  onPress={handleSubmit}
                  disabled={!canSubmit || loading}
                />
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
            <Lock size={14} color={Colors.textSecondary} />
            <EyeOff size={14} color={Colors.textSecondary} />
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
            <Button label="SCAN QR CODE" onPress={() => router.push("/scan")} />
            <Button label="BREACH CHECK" onPress={() => router.push("/breach")} />
            <Button label="SETTINGS" onPress={() => router.push("/settings")} />
          </View>
        </ScrollView>

        {loading && <LoadingOverlay />}
      </SafeAreaView>

      <AIConsentModal
        visible={showModal}
        onAccept={acceptConsent}
      />
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
  imageStrip: {
    maxHeight: 80,
    paddingHorizontal: 12,
  },
  imageStripContent: {
    gap: 8,
    paddingVertical: 4,
  },
  imageThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: "hidden",
    position: "relative",
  },
  thumbImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  removeButton: {
    position: "absolute",
    top: -2,
    right: -2,
    backgroundColor: Colors.white,
    borderRadius: 10,
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
});

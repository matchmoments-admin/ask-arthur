import { useState, useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QRScanner } from "@/components/QRScanner";
import { AnalysisResultView } from "@/components/AnalysisResult";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { useAnalysis } from "@/hooks/useAnalysis";
import { Colors } from "@/constants/colors";

export default function ScanScreen() {
  const { result, loading, error, analyze, reset } = useAnalysis();
  const [scannerActive, setScannerActive] = useState(true);

  const handleScan = useCallback(
    (content: string, type: "url" | "text") => {
      setScannerActive(false);
      analyze(content, type === "url" ? "qrcode" : "text");
    },
    [analyze]
  );

  const handleReset = useCallback(() => {
    reset();
    setScannerActive(true);
  }, [reset]);

  // Show result
  if (result) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <AnalysisResultView result={result} />
        <View style={styles.footer}>
          <Pressable style={styles.button} onPress={handleReset}>
            <Text style={styles.buttonText}>Scan Another</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // Show error
  if (error) {
    return (
      <SafeAreaView style={styles.centered} edges={["bottom"]}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.button} onPress={handleReset}>
          <Text style={styles.buttonText}>Try Again</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <QRScanner onScan={handleScan} active={scannerActive} />
      {loading && <LoadingOverlay message="Checking QR code..." />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 32,
    backgroundColor: Colors.background,
  },
  errorText: {
    fontSize: 16,
    color: Colors.error,
    textAlign: "center",
    marginBottom: 16,
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
  buttonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: "600",
  },
});

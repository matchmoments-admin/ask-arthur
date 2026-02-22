import { useState, useCallback } from "react";
import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { QRScanner } from "@/components/QRScanner";
import { AnalysisResultView } from "@/components/AnalysisResult";
import { LoadingOverlay } from "@/components/LoadingOverlay";
import { Button } from "@/components/Button";
import { useAnalysis } from "@/hooks/useAnalysis";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

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

  if (result) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <AnalysisResultView result={result} />
        <View style={styles.footer}>
          <Button label="Scan Another" onPress={handleReset} />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.centered} edges={["bottom"]}>
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
        <Button label="Try Again" onPress={handleReset} />
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.scanContainer}>
      <QRScanner onScan={handleScan} active={scannerActive} />
      {loading && <LoadingOverlay message="Checking QR code..." />}
    </View>
  );
}

const styles = StyleSheet.create({
  scanContainer: {
    flex: 1,
    backgroundColor: Colors.black,
  },
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
  errorCard: {
    backgroundColor: Colors.errorBg,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.error,
  },
  errorText: {
    fontSize: 16,
    color: Colors.error,
    textAlign: "center",
    fontFamily: Fonts.regular,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.white,
  },
});

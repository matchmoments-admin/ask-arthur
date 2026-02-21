import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Colors } from "@/constants/colors";

interface LoadingOverlayProps {
  message?: string;
}

export function LoadingOverlay({ message = "Analysing..." }: LoadingOverlayProps) {
  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.message}>{message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 16,
  },
  message: {
    fontSize: 16,
    color: Colors.text,
    fontWeight: "500",
  },
});

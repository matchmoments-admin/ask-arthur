import { View, Text, ActivityIndicator, StyleSheet } from "react-native";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

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
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 100,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 16,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  message: {
    fontSize: 16,
    fontFamily: Fonts.medium,
    color: Colors.navy,
  },
});

import { Pressable, Text, StyleSheet } from "react-native";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "block" | "pill";
}

export function Button({ label, onPress, disabled, variant = "block" }: ButtonProps) {
  const isPill = variant === "pill";

  return (
    <Pressable
      style={[
        styles.base,
        isPill ? styles.pill : styles.block,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Text style={[styles.text, isPill && styles.pillText]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  block: {
    borderRadius: 10,
    paddingVertical: 18,
  },
  pill: {
    height: 44,
    paddingHorizontal: 24,
    borderRadius: 9999,
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    color: Colors.textOnDark,
    fontSize: 15,
    fontFamily: Fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 3,
  },
  pillText: {
    fontSize: 13,
  },
});

import { View, Text, StyleSheet, Modal, Pressable, Linking } from "react-native";
import { Colors } from "@/constants/colors";
import { Fonts } from "@/constants/fonts";

interface AIConsentModalProps {
  visible: boolean;
  onAccept: () => void;
  onLearnMore?: () => void;
}

export function AIConsentModal({ visible, onAccept, onLearnMore }: AIConsentModalProps) {
  const handleLearnMore = () => {
    if (onLearnMore) {
      onLearnMore();
    } else {
      Linking.openURL("https://askarthur.au/privacy");
    }
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
    >
      <View style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>AI-Powered Analysis</Text>

          <Text style={styles.body}>
            Ask Arthur uses{" "}
            <Text style={styles.bold}>Anthropic's Claude AI</Text> to analyse
            your messages for scam indicators.
          </Text>

          <Text style={styles.body}>
            Content is transmitted to Anthropic, analysed, and immediately
            discarded. Personal information is automatically scrubbed before
            transmission. No data is stored or used for model training.
          </Text>

          <View style={styles.buttonGroup}>
            <Pressable style={styles.primaryButton} onPress={onAccept}>
              <Text style={styles.primaryButtonText}>I Agree</Text>
            </Pressable>

            <Pressable style={styles.secondaryButton} onPress={handleLearnMore}>
              <Text style={styles.secondaryButtonText}>Learn More</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  content: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 28,
    gap: 16,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  title: {
    fontSize: 22,
    fontFamily: Fonts.bold,
    color: Colors.navy,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    lineHeight: 23,
    fontFamily: Fonts.regular,
    color: Colors.text,
  },
  bold: {
    fontFamily: Fonts.bold,
    color: Colors.navy,
  },
  buttonGroup: {
    gap: 12,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: Colors.navy,
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  primaryButtonText: {
    color: Colors.textOnDark,
    fontSize: 15,
    fontFamily: Fonts.bold,
    textTransform: "uppercase",
    letterSpacing: 3,
  },
  secondaryButton: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  secondaryButtonText: {
    color: Colors.primary,
    fontSize: 15,
    fontFamily: Fonts.semiBold,
  },
});

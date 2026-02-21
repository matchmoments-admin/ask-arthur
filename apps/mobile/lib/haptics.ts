import * as Haptics from "expo-haptics";
import type { Verdict } from "@askarthur/types";

/**
 * Trigger haptic feedback based on verdict severity.
 */
export function verdictHaptic(verdict: Verdict): void {
  switch (verdict) {
    case "SAFE":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      break;
    case "SUSPICIOUS":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      break;
    case "HIGH_RISK":
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      break;
  }
}

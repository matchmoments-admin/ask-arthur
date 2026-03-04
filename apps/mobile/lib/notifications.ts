import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import type { Router } from "expo-router";
import type { AnalysisResult } from "@askarthur/types";
import {
  CHANNEL_ID,
  CHANNEL_CONFIG,
  VERDICT_NOTIFICATION_COLOR,
  VERDICT_NOTIFICATION_TITLE,
  ACTION_IDS,
} from "@/constants/notification-config";

// Configure notification behavior when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowInForeground: true,
  }),
});

/**
 * Create Android notification channel on app start.
 * No-op on iOS (channels are Android-only).
 */
export async function initNotifications(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: CHANNEL_CONFIG.name,
      description: CHANNEL_CONFIG.description,
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: CHANNEL_CONFIG.vibration ? [0, 250, 250, 250] : undefined,
      enableLights: CHANNEL_CONFIG.lights,
    });
  }
}

/**
 * Request notification permission from the user.
 * Returns true if granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  if (existingStatus === "granted") return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === "granted";
}

/**
 * Get the Expo push token for remote push notifications.
 * Returns null if permissions not granted or unavailable.
 */
export async function getExpoPushToken(): Promise<string | null> {
  const granted = await requestNotificationPermission();
  if (!granted) return null;

  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: "21a9c339-8761-450c-ae1f-1b89b5e904d0",
    });
    return tokenData.data;
  } catch {
    return null;
  }
}

/**
 * Display an analysis result as a rich notification.
 */
export async function showAnalysisNotification(
  result: AnalysisResult,
): Promise<void> {
  const color = VERDICT_NOTIFICATION_COLOR[result.verdict];
  const title = VERDICT_NOTIFICATION_TITLE[result.verdict];
  const confidence = Math.round(result.confidence * 100);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${title} (${confidence}%)`,
      body: result.summary,
      color,
      sound: "default",
      data: {
        actionId: ACTION_IDS.VIEW_DETAILS,
        verdict: result.verdict,
      },
    },
    trigger: null, // Show immediately
  });
}

/**
 * Register foreground notification event handler.
 * Call once in the root layout.
 */
export function handleNotificationAction(router: Router): void {
  // Handle notification taps (when user taps the notification)
  const subscription = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const data = response.notification.request.content.data;
      const actionId = (data?.actionId as string) ?? "";

      if (actionId === ACTION_IDS.VIEW_DETAILS) {
        router.navigate("/");
      }
    },
  );

  // Return cleanup function if needed (caller can ignore)
  return void subscription;
}

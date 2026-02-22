import notifee, { AndroidImportance, EventType } from "@notifee/react-native";
import { Linking, Platform } from "react-native";
import type { Router } from "expo-router";
import type { AnalysisResult } from "@askarthur/types";
import {
  CHANNEL_ID,
  CHANNEL_CONFIG,
  VERDICT_NOTIFICATION_COLOR,
  VERDICT_NOTIFICATION_TITLE,
  ACTION_IDS,
} from "@/constants/notification-config";

/**
 * Create Android notification channel on app start.
 * No-op on iOS (channels are Android-only).
 */
export async function initNotifications(): Promise<void> {
  if (Platform.OS === "android") {
    await notifee.createChannel({
      id: CHANNEL_CONFIG.id,
      name: CHANNEL_CONFIG.name,
      description: CHANNEL_CONFIG.description,
      importance: AndroidImportance.HIGH,
      vibration: CHANNEL_CONFIG.vibration,
      lights: CHANNEL_CONFIG.lights,
    });
  }
}

/**
 * Request notification permission from the user.
 * Returns true if granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  const settings = await notifee.requestPermission();
  // iOS authorization status: 1 = authorized
  // Android always returns authorized after channel creation
  return settings.authorizationStatus >= 1;
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

  const actions = [
    {
      title: "View Details",
      pressAction: { id: ACTION_IDS.VIEW_DETAILS },
    },
  ];

  if (result.verdict === "HIGH_RISK" || result.verdict === "SUSPICIOUS") {
    actions.push({
      title: "Report Scam",
      pressAction: { id: ACTION_IDS.REPORT_SCAM },
    });
  }

  await notifee.displayNotification({
    title: `${title} (${confidence}%)`,
    body: result.summary,
    android: {
      channelId: CHANNEL_ID,
      color,
      smallIcon: "ic_notification",
      pressAction: { id: "default", launchActivity: "default" },
      style: {
        type: 1, // BigTextStyle
        text: result.summary,
      },
      actions,
    },
    ios: {
      sound: "default",
    },
  });
}

/**
 * Register foreground notification event handler.
 * Call once in the root layout.
 */
export function handleNotificationAction(router: Router): void {
  notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.ACTION_PRESS && detail.pressAction) {
      const actionId = detail.pressAction.id;

      if (actionId === ACTION_IDS.VIEW_DETAILS) {
        router.navigate("/");
      } else if (actionId === ACTION_IDS.REPORT_SCAM) {
        Linking.openURL("https://www.scamwatch.gov.au/report-a-scam");
      }
    }

    if (type === EventType.PRESS) {
      router.navigate("/");
    }
  });
}

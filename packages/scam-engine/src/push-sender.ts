import { logger } from "@askarthur/utils/logger";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
  priority?: "default" | "normal" | "high";
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: Record<string, unknown>;
}

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH_SIZE = 100;

/**
 * Send push notifications via the Expo Push API.
 * Automatically batches messages (max 100 per request per Expo's limit).
 */
export async function sendPushNotifications(
  messages: ExpoPushMessage[]
): Promise<ExpoPushTicket[]> {
  const tickets: ExpoPushTicket[] = [];

  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);

    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(batch),
      });

      if (!res.ok) {
        logger.error("Expo Push API error", {
          status: res.status,
          batch: i / BATCH_SIZE,
        });
        continue;
      }

      const result = await res.json();
      const batchTickets: ExpoPushTicket[] = result.data ?? [];
      tickets.push(...batchTickets);

      // Log errors for individual messages
      for (const ticket of batchTickets) {
        if (ticket.status === "error") {
          logger.warn("Push notification failed", {
            message: ticket.message,
            details: ticket.details,
          });
        }
      }
    } catch (err) {
      logger.error("Failed to send push batch", { error: err, batch: i / BATCH_SIZE });
    }
  }

  return tickets;
}

/**
 * Build a scam alert push message.
 */
export function buildScamAlertMessage(
  token: string,
  alertType: string,
  summary: string
): ExpoPushMessage {
  return {
    to: token,
    title: `Scam Alert: ${alertType}`,
    body: summary,
    sound: "default",
    channelId: "scam-alerts",
    priority: "high",
    data: {
      type: "scam_alert",
      alertType,
    },
  };
}

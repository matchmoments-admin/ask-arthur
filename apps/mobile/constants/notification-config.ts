import type { Verdict } from "@askarthur/types";

export const CHANNEL_ID = "scam_alerts";

export const CHANNEL_CONFIG = {
  id: CHANNEL_ID,
  name: "Scam Alerts",
  description: "Analysis results and scam detection alerts",
  importance: 4, // HIGH
  vibration: true,
  lights: true,
} as const;

export const VERDICT_NOTIFICATION_COLOR: Record<Verdict, string> = {
  HIGH_RISK: "#D32F2F",
  SUSPICIOUS: "#F57C00",
  UNCERTAIN: "#6B7C93",
  SAFE: "#388E3C",
};

export const VERDICT_NOTIFICATION_TITLE: Record<Verdict, string> = {
  HIGH_RISK: "High Risk Detected",
  SUSPICIOUS: "Suspicious Content",
  UNCERTAIN: "Couldn't Determine Risk",
  SAFE: "Message Appears Safe",
};

export const ACTION_IDS = {
  VIEW_DETAILS: "view_details",
  REPORT_SCAM: "report_scam",
} as const;

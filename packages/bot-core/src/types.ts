import type { AnalysisResult } from "@askarthur/types";

export type Platform = "telegram" | "whatsapp" | "slack";

export interface BotMessage {
  platform: Platform;
  userId: string;
  text: string;
  /** Username or display name, if available */
  userName?: string;
  /** Whether this message was forwarded from another user */
  isForwarded?: boolean;
}

export interface BotResponse {
  analysis: AnalysisResult;
  /** Pre-formatted message for the target platform */
  formatted: string;
}

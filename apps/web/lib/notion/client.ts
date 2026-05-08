import { Client } from "@notionhq/client";
import { logger } from "@askarthur/utils/logger";

let cached: Client | null = null;

export function getNotionClient(): Client | null {
  if (cached) return cached;
  const auth = process.env.NOTION_TOKEN;
  if (!auth) {
    logger.warn("NOTION_TOKEN not set — Notion writes will be skipped");
    return null;
  }
  cached = new Client({ auth, notionVersion: "2022-06-28" });
  return cached;
}

export function getFeedbackDbId(): string | null {
  return process.env.NOTION_FEEDBACK_DB_ID ?? null;
}

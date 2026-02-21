import type { InlineKeyboard as InlineKeyboardType } from "grammy";
import { InlineKeyboard } from "grammy";
import type { Verdict } from "@askarthur/types";

/**
 * Build follow-up action keyboard based on the verdict.
 */
export function buildResultKeyboard(verdict: Verdict): InlineKeyboardType {
  const keyboard = new InlineKeyboard();

  if (verdict === "HIGH_RISK" || verdict === "SUSPICIOUS") {
    keyboard
      .text("Report to Scamwatch", "action:report")
      .row();
  }

  keyboard.text("Check another message", "action:check_another");

  return keyboard;
}

/**
 * Simple keyboard prompting the user to send a message.
 */
export function buildCheckPromptKeyboard(): InlineKeyboardType {
  return new InlineKeyboard()
    .text("How to forward a message", "action:help_forward");
}

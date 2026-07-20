import { analyzeForBotDetailed } from "@askarthur/bot-core/analyze";
import { toMessengerMessage } from "@askarthur/bot-core/format-messenger";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { featureFlags } from "@askarthur/utils/feature-flags";
import type { AnalysisResult } from "@askarthur/types";
import {
  sendTextMessage,
  sendQuickReplies,
  sendTypingOn,
  type MessengerQuickReply,
} from "./api";
import { downloadMessengerAttachment } from "./media";
import { isReplay } from "../replay-dedup";
import { getBotRedis } from "../redis";
import {
  stashBotReport,
  buildReportStash,
  reportBotScam,
} from "../onward-report";

// Fallback when there's nothing to report against (stash expired / attribution
// off) — the pre-onward static guidance.
const REPORT_FALLBACK =
  "Report this scam:\n\n" +
  "• Scamwatch: scamwatch.gov.au/report-a-scam\n" +
  "• ReportCyber: cyber.gov.au/report-and-recover/report\n" +
  "• Contact your bank immediately if you've shared financial details";

const DISCLOSURE_MESSAGE =
  "Welcome to Ask Arthur — Australia's scam detection service. " +
  "I use Anthropic's Claude AI to analyse messages for scam indicators. " +
  "Your messages are processed in real-time and never stored.\n\n" +
  "Forward me a suspicious message or screenshot to check it.";

async function hashUserId(id: string): Promise<string> {
  const data = new TextEncoder().encode(id);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Send the first-time AI disclosure once per user (30-day Redis TTL).
 * Returns true if the disclosure was sent (i.e. this is a new user).
 */
async function sendDisclosureIfNew(senderId: string): Promise<boolean> {
  const redis = getBotRedis();
  if (!redis) return false;

  const hash = await hashUserId(senderId);
  const key = `messenger:seen:${hash}`;
  const seen = await redis.get(key);
  if (seen) return false;

  await redis.set(key, "1", { ex: 30 * 24 * 60 * 60 });
  await sendTextMessage(senderId, DISCLOSURE_MESSAGE);
  return true;
}

// Multi-turn "send their profile" state for the Marketplace deeper-check flow.
// After a non-SAFE Marketplace verdict on a text message we stash that text
// under a short-TTL key; the next profile screenshot the user sends is analysed
// TOGETHER with it (message + profile → one verdict). This is how the "new
// account" signal is obtained — Meta exposes no account age via API (ADR-0023),
// so it can only come from a screenshot the user chooses to send. Fail-open: no
// Redis just means the screenshot is analysed on its own.
const PENDING_TTL_SECONDS = 15 * 60;

async function stashPendingMarketplace(
  senderId: string,
  text: string,
): Promise<void> {
  const redis = getBotRedis();
  if (!redis) return;
  const hash = await hashUserId(senderId);
  await redis.set(`messenger:pending:${hash}`, text, { ex: PENDING_TTL_SECONDS });
}

async function takePendingMarketplace(senderId: string): Promise<string | null> {
  const redis = getBotRedis();
  if (!redis) return null;
  const hash = await hashUserId(senderId);
  // getdel: read-and-clear atomically so the pending text drives exactly one
  // follow-up screenshot.
  const text = await redis.getdel<string>(`messenger:pending:${hash}`);
  return typeof text === "string" && text.length > 0 ? text : null;
}

interface MessengerAttachment {
  type?: string;
  payload?: { url?: string };
}

interface MessengerMessage {
  text?: string;
  mid?: string;
  is_echo?: boolean;
  quick_reply?: { payload?: string };
  attachments?: MessengerAttachment[];
}

interface MessengerWebhookPayload {
  object?: string;
  entry?: Array<{
    messaging?: Array<{
      sender?: { id: string };
      message?: MessengerMessage;
      postback?: { payload?: string };
    }>;
  }>;
}

/**
 * Process an incoming Messenger webhook payload.
 */
export async function handleMessengerWebhook(
  payload: MessengerWebhookPayload,
): Promise<void> {
  if (payload.object !== "page") return;

  const messaging = payload.entry?.[0]?.messaging;
  if (!messaging || messaging.length === 0) return;

  for (const event of messaging) {
    const senderId = event.sender?.id;
    if (!senderId) continue;

    // Ignore echoes of the Page's own outbound messages (avoids self-analysis loops)
    if (event.message?.is_echo) continue;

    // Skip retries/replays of a message we've already handled (Meta re-delivers
    // on any slow/non-2xx response). Postbacks/quick-replies carry no mid; those
    // are idempotent static replies, so leaving them undeduped is harmless.
    if (event.message?.mid && (await isReplay("messenger", event.message.mid))) {
      continue;
    }

    try {
      // Quick-reply tap or persistent-menu postback
      const actionPayload =
        event.message?.quick_reply?.payload ?? event.postback?.payload;
      if (actionPayload) {
        await handleAction(senderId, actionPayload);
        continue;
      }

      await processEvent(senderId, event.message);
    } catch (err) {
      logger.error("Messenger message processing failed", {
        error: String(err),
        senderId,
      });
    }
  }
}

async function processEvent(
  senderId: string,
  message?: MessengerMessage,
): Promise<void> {
  // AI disclosure on first interaction
  await sendDisclosureIfNew(senderId);

  const imageUrl = message?.attachments?.find((a) => a.type === "image")?.payload
    ?.url;
  const text = message?.text?.trim();

  // Image path — a forwarded screenshot / Marketplace listing / profile photo.
  if (imageUrl) {
    // Multi-turn: if the user was just told to "send their profile" after a
    // Marketplace verdict, analyse that earlier message + this screenshot
    // together. An image caption also counts as context.
    const pendingText = await takePendingMarketplace(senderId);
    await processImageMessage(senderId, imageUrl, pendingText ?? text);
    return;
  }

  // Text path — analyse whenever text is present, EVEN if a link-preview
  // "fallback" attachment rode along. Messenger attaches one to any message
  // containing a URL, so checking text BEFORE bailing on attachments is the fix
  // for the bug where "AusPost … http://…" was rejected without analysis.
  if (text) {
    await processAnalysis(senderId, text);
    return;
  }

  // No usable text and no image: a genuinely unsupported attachment (video,
  // file, location, sticker) or an empty message.
  if (message?.attachments && message.attachments.length > 0) {
    await sendTextMessage(
      senderId,
      "I can only check text and image screenshots right now. Paste the suspicious message, or send a screenshot of it.",
    );
    return;
  }
  await sendTextMessage(
    senderId,
    "Send me a suspicious message or screenshot and I'll check it for scam indicators.",
  );
}

async function processImageMessage(
  senderId: string,
  url: string,
  combinedText?: string,
): Promise<void> {
  const rateLimit = await checkBotRateLimit("messenger", senderId);
  if (!rateLimit.allowed) {
    await sendTextMessage(
      senderId,
      rateLimit.message ?? "Rate limit exceeded. Please try again later.",
    );
    return;
  }

  try {
    await sendTypingOn(senderId);
    const base64 = await downloadMessengerAttachment(url);
    if (!base64) {
      await sendTextMessage(
        senderId,
        "Sorry, I couldn't download that image. Please try sending it again, or paste the suspicious text instead.",
      );
      return;
    }

    // When we have earlier message text (the Marketplace "send their profile"
    // flow) or an image caption, pass BOTH text + image so Claude reasons over
    // the conversation AND the profile screenshot in one verdict.
    const prompt = combinedText?.trim()
      ? combinedText
      : "Analyse this image for scam indicators";
    const { result, scamReportId } = await analyzeForBotDetailed(
      prompt,
      undefined,
      [base64],
      { source: "bot_messenger", userId: senderId, inputMode: "image" },
    );
    await sendResult(senderId, result);
    if (scamReportId) {
      await stashBotReport("messenger", senderId, buildReportStash(scamReportId, result));
    }
  } catch (err) {
    logger.error("Messenger image analysis failed", { error: String(err) });
    await sendTextMessage(
      senderId,
      "Sorry, I couldn't analyse that image right now. Please try again in a moment.",
    );
  }
}

async function processAnalysis(senderId: string, text: string): Promise<void> {
  const rateLimit = await checkBotRateLimit("messenger", senderId);
  if (!rateLimit.allowed) {
    await sendTextMessage(
      senderId,
      rateLimit.message ?? "Rate limit exceeded. Please try again later.",
    );
    return;
  }

  try {
    await sendTypingOn(senderId);
    const { result, scamReportId } = await analyzeForBotDetailed(text, undefined, undefined, {
      source: "bot_messenger",
      userId: senderId,
      inputMode: "text",
    });

    // Marketplace deeper-check: on a non-SAFE verdict, offer to also read the
    // other party's profile (the only way to get the "new account" signal —
    // Meta exposes no account age via API). Stash the message so the next
    // screenshot is analysed together with it.
    const offerProfile =
      featureFlags.botMarketplaceMode &&
      (result.verdict === "HIGH_RISK" || result.verdict === "SUSPICIOUS");
    if (offerProfile) {
      await stashPendingMarketplace(senderId, text);
    }

    await sendResult(senderId, result, offerProfile);
    if (scamReportId) {
      await stashBotReport("messenger", senderId, buildReportStash(scamReportId, result));
    }
  } catch (err) {
    logger.error("Messenger analysis failed", { error: String(err) });
    await sendTextMessage(
      senderId,
      "Sorry, I couldn't analyse that message right now. Please try again in a moment.",
    );
  }
}

/**
 * Format and send an analysis result, splitting over Messenger's 2000-char
 * limit and attaching follow-up quick replies to the final message.
 */
async function sendResult(
  senderId: string,
  result: AnalysisResult,
  offerProfile = false,
): Promise<void> {
  const formatted = toMessengerMessage(result);
  const chunks = (formatted.length > 2000
    ? splitMessage(formatted, 2000)
    : [formatted]
  ).filter((c) => c.length > 0);
  // Defensive: the formatter always emits a verdict line + footer, but never
  // send an empty body (the Send API 400s on `text: undefined`).
  if (chunks.length === 0) return;

  // Send all but the final chunk as plain text
  for (let i = 0; i < chunks.length - 1; i++) {
    await sendTextMessage(senderId, chunks[i]);
  }

  // Attach follow-up quick replies to the final chunk
  const replies: MessengerQuickReply[] = [];
  if (result.verdict === "HIGH_RISK" || result.verdict === "SUSPICIOUS") {
    replies.push({ title: "Report scam", payload: "action:report" });
    if (offerProfile) {
      replies.push({ title: "Check their profile", payload: "action:profile" });
    }
  }
  replies.push({ title: "Check another", payload: "action:check" });
  replies.push({ title: "About", payload: "action:about" });

  await sendQuickReplies(senderId, chunks[chunks.length - 1], replies);
}

async function handleAction(senderId: string, payload: string): Promise<void> {
  if (payload === "action:report") {
    const reply = await reportBotScam("messenger", senderId);
    await sendTextMessage(senderId, reply ?? REPORT_FALLBACK);
  } else if (payload === "action:check") {
    await sendTextMessage(
      senderId,
      "Send me another message or screenshot to check \u{1f50d}",
    );
  } else if (payload === "action:profile") {
    // The message text was stashed when we offered this; the next screenshot
    // the user sends is analysed together with it (see processEvent image path).
    await sendTextMessage(
      senderId,
      "\u{1f4f8} Send me a screenshot of their Facebook or Marketplace profile — I'll check when the account was created, their reviews and friend count, and factor that into the verdict. (New accounts selling high-value items are a common scam sign.)",
    );
  } else if (payload === "action:about") {
    await sendTextMessage(senderId, DISCLOSURE_MESSAGE);
  }
}

function splitMessage(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  const lines = text.split("\n");
  let current = "";

  for (const line of lines) {
    // A single line longer than the limit must be hard-split, or it would be
    // pushed verbatim and rejected by the Send API (>2000 chars).
    if (line.length > maxLength) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
      continue;
    }
    if (current.length + line.length + 1 > maxLength) {
      chunks.push(current.trim());
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

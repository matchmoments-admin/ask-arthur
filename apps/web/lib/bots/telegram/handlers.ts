import type { Bot, Context } from "grammy";
import { analyzeForBot } from "@askarthur/bot-core/analyze";
import { toTelegramHTML } from "@askarthur/bot-core/format-telegram";
import { checkBotRateLimit } from "@askarthur/bot-core/rate-limit";
import { logger } from "@askarthur/utils/logger";
import { buildResultKeyboard, buildCheckPromptKeyboard } from "./keyboards";

const WELCOME_MESSAGE = `\u{1f6e1}\ufe0f <b>Welcome to Ask Arthur!</b>

I help Australians detect scams. Here's how to use me:

<b>Option 1:</b> Forward a suspicious message to me
<b>Option 2:</b> Paste the text of a message you're unsure about
<b>Option 3:</b> Use /check followed by the text

I'll analyse it and tell you if it's likely a scam.

<i>Your messages are analysed privately and never stored with your identity.</i>`;

const HELP_MESSAGE = `\u{1f6e1}\ufe0f <b>Ask Arthur \u2014 Commands</b>

/start \u2014 Welcome message
/check &lt;text&gt; \u2014 Check a message for scams
/help \u2014 Show this help
/privacy \u2014 Privacy information

<b>Or simply:</b>
\u2022 Forward any suspicious message to me
\u2022 Paste text directly into the chat

I use AI to analyse messages for common Australian scam patterns including MyGov, ATO, bank, and delivery scams.`;

const PRIVACY_MESSAGE = `\u{1f512} <b>Privacy</b>

\u2022 Messages are analysed by AI and not stored with your identity
\u2022 High-risk scams are stored anonymously to help protect others
\u2022 Personal information (emails, phone numbers, etc.) is scrubbed before analysis
\u2022 We don't share your data with third parties

Read our full privacy policy at <a href="https://askarthur.au/privacy">askarthur.au/privacy</a>`;

async function handleRateLimit(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id?.toString();
  if (!userId) return false;

  const rateLimit = await checkBotRateLimit("telegram", userId);
  if (!rateLimit.allowed) {
    await ctx.reply(rateLimit.message ?? "Rate limit exceeded. Please try again later.");
    return true;
  }
  return false;
}

async function analyzeAndReply(ctx: Context, text: string): Promise<void> {
  if (!text.trim()) {
    await ctx.reply("Please send me a message to check. You can forward a suspicious message or paste the text.");
    return;
  }

  if (await handleRateLimit(ctx)) return;

  await ctx.replyWithChatAction("typing");

  try {
    const result = await analyzeForBot(text);
    const formatted = toTelegramHTML(result);
    const keyboard = buildResultKeyboard(result.verdict);

    await ctx.reply(formatted, {
      parse_mode: "HTML",
      reply_markup: keyboard,
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    logger.error("Telegram analysis failed", { error: String(err) });
    await ctx.reply("Sorry, I couldn't analyse that message right now. Please try again in a moment.");
  }
}

/**
 * Register all handlers on the bot instance.
 */
export function registerHandlers(bot: Bot): void {
  // /start command
  bot.command("start", async (ctx) => {
    await ctx.reply(WELCOME_MESSAGE, {
      parse_mode: "HTML",
      reply_markup: buildCheckPromptKeyboard(),
    });
  });

  // /help command
  bot.command("help", async (ctx) => {
    await ctx.reply(HELP_MESSAGE, { parse_mode: "HTML" });
  });

  // /privacy command
  bot.command("privacy", async (ctx) => {
    await ctx.reply(PRIVACY_MESSAGE, {
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    });
  });

  // /check <text> command
  bot.command("check", async (ctx) => {
    const text = ctx.match;
    if (!text) {
      await ctx.reply("Usage: /check &lt;paste the suspicious message here&gt;", { parse_mode: "HTML" });
      return;
    }
    await analyzeAndReply(ctx, text);
  });

  // Callback queries (inline keyboard buttons)
  bot.callbackQuery("action:report", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      '\u{1f4cb} <b>Report this scam:</b>\n\n' +
      '\u2022 <a href="https://www.scamwatch.gov.au/report-a-scam">Scamwatch</a> \u2014 ACCC\'s scam reporting tool\n' +
      '\u2022 <a href="https://www.cyber.gov.au/report-and-recover/report">ReportCyber</a> \u2014 for cybercrime\n' +
      '\u2022 Contact your bank immediately if you\'ve shared financial details',
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
  });

  bot.callbackQuery("action:check_another", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Send me another message to check \u{1f50d}");
  });

  bot.callbackQuery("action:help_forward", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      "<b>How to forward a message:</b>\n\n" +
      "1. Open the suspicious message in its original app\n" +
      "2. Long-press the message\n" +
      '3. Tap "Forward"\n' +
      "4. Select Ask Arthur as the recipient\n\n" +
      "Or simply copy and paste the text here!",
      { parse_mode: "HTML" }
    );
  });

  // Plain text messages (catch-all — also handles forwarded messages)
  bot.on("message:text", async (ctx) => {
    await analyzeAndReply(ctx, ctx.message.text);
  });
}

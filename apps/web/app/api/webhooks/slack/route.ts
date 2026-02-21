import { verifySlackSignature } from "@askarthur/bot-core/webhook-verify";
import { logger } from "@askarthur/utils/logger";
import { parseSlashCommand, handleSlashCommand } from "@/lib/bots/slack/handler";

/**
 * POST: Slack slash command handler (/checkscam).
 * Must acknowledge within 3 seconds, then process via response_url.
 */
export async function POST(req: Request) {
  const rawBody = await req.text();

  // Verify Slack signing secret
  if (!verifySlackSignature(req, rawBody)) {
    logger.warn("Slack webhook: invalid signature");
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = parseSlashCommand(rawBody);

  // Process in background — acknowledge immediately
  const processPromise = handleSlashCommand(payload);
  processPromise.catch((err) =>
    logger.error("Slack slash command processing failed", { error: String(err) })
  );

  // Acknowledge within 3 seconds with ephemeral "Analysing..." message
  return Response.json(
    {
      response_type: "ephemeral",
      text: "\u{1f50d} Analysing message for scam indicators...",
    },
    { status: 200 }
  );
}

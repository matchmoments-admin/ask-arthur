import { getNotionClient, getFeedbackDbId } from "./client";
import { logger } from "@askarthur/utils/logger";

export type FeedbackType = "bug" | "improvement" | "feature";

export interface FeedbackPayload {
  type: FeedbackType;
  title: string;
  description: string;
  reporterEmail?: string | null;
  reporterName?: string | null;
  // Bug-only
  stepsToReproduce?: string | null;
  severity?: "Blocker" | "Critical" | "Major" | "Minor" | null;
  // Improvement-only
  currentBehavior?: string | null;
  desiredBehavior?: string | null;
  // Feature-only
  problem?: string | null;
  useCase?: string | null;
  // Auto-attached
  url?: string | null;
  userAgent?: string | null;
  appVersion?: string | null;
  source?: "web" | "extension" | "mobile";
}

export interface FeedbackPageResult {
  id: string;
  url: string;
}

const TYPE_LABEL: Record<FeedbackType, string> = {
  bug: "Bug",
  improvement: "Improvement",
  feature: "Feature",
};

const SEVERITY_TO_PRIORITY: Record<NonNullable<FeedbackPayload["severity"]>, string> = {
  Blocker: "P0",
  Critical: "P1",
  Major: "P2",
  Minor: "P3",
};

function rt(content: string | null | undefined) {
  const c = (content ?? "").slice(0, 1990);
  return c ? { rich_text: [{ type: "text" as const, text: { content: c } }] } : undefined;
}

function selectProp(name: string | null | undefined) {
  return name ? { select: { name } } : undefined;
}

/**
 * Create a Notion page in the Feedback Tracker DB. Returns null if Notion is
 * unconfigured or the call fails — callers should NOT block their response on
 * this. The leads insert is the durable record; Notion is best-effort triage.
 */
export async function createFeedbackPage(
  payload: FeedbackPayload
): Promise<FeedbackPageResult | null> {
  const notion = getNotionClient();
  const dbId = getFeedbackDbId();
  if (!notion || !dbId) return null;

  const priority =
    payload.type === "bug" && payload.severity
      ? SEVERITY_TO_PRIORITY[payload.severity]
      : "P3";

  try {
    // The Notion SDK's typed properties union is wide; we build the payload
    // dynamically and let the runtime validate. Type-narrowing every property
    // pulls in the entire @notionhq/client surface for no real benefit here.
    const properties: Record<string, unknown> = {
      Title: { title: [{ type: "text", text: { content: payload.title.slice(0, 200) } }] },
      Type: selectProp(TYPE_LABEL[payload.type]),
      Priority: selectProp(priority),
      Description: rt(payload.description),
      URL: payload.url ? { url: payload.url } : undefined,
      "Browser/OS": rt(payload.userAgent),
      "App Version": rt(payload.appVersion),
      "Submitted At": { date: { start: new Date().toISOString() } },
      Source: selectProp(payload.source ?? "web"),
    };
    if (payload.reporterEmail) properties.Reporter = { email: payload.reporterEmail };
    if (payload.severity) properties.Severity = selectProp(payload.severity);
    if (payload.stepsToReproduce) properties.Steps = rt(payload.stepsToReproduce);
    if (payload.currentBehavior) properties.Current = rt(payload.currentBehavior);
    if (payload.desiredBehavior) properties.Desired = rt(payload.desiredBehavior);
    if (payload.problem) properties.Problem = rt(payload.problem);
    if (payload.useCase) properties["Use Case"] = rt(payload.useCase);

    // Strip undefined values so Notion doesn't reject the payload
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(properties)) {
      if (v !== undefined) cleaned[k] = v;
    }

    const page = await notion.pages.create({
      parent: { database_id: dbId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: cleaned as any,
    });

    const url =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (page as any).url ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      `https://notion.so/${String((page as any).id).replace(/-/g, "")}`;

    return { id: page.id, url };
  } catch (err) {
    logger.error("Notion feedback page create failed", { error: String(err) });
    return null;
  }
}

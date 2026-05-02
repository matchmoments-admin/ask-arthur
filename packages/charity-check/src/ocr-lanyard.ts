// Lanyard OCR via Claude Vision — extracts structured fields from a
// photo of a fundraiser's ID badge / lanyard / donation flyer.
//
// The strategy memo's anchor scenario is the donor stopped on Bourke St.
// They can't easily type a charity name with one hand on the phone while
// a stranger is talking to them — but they CAN snap a photo of the
// fundraiser's ID badge. This helper lets the /charity-check engine
// accept that photo and pull out the queryable fields.
//
// Cost: ~$0.002-$0.01 per image (Claude Haiku vision pricing). Covered
// by the existing `feature_brakes.charity_check` $5/day cap. The route
// also enforces the per-IP 5/h rate limit, so even at the worst case
// the spend is bounded to ~$0.05/IP/hour.
//
// The return shape is intentionally optional/permissive — if the model
// can't read the image cleanly, every field comes back undefined and the
// engine falls back to whatever the user typed (or returns "no input").

import Anthropic from "@anthropic-ai/sdk";

import { logger } from "@askarthur/utils/logger";

export interface LanyardExtraction {
  /** Charity legal name as printed on the badge / lanyard / flyer. */
  charity_name?: string;
  /** 11-digit ABN if visible. Digits only — no spaces or dashes. */
  abn?: string;
  /** ACNC charity number (often printed alongside or instead of ABN). */
  acnc_number?: string;
  /** Fundraising-agency name when the fundraiser is contracted. PFRA
   *  member agencies include Cornucopia, Surge Direct, etc. */
  agency_name?: string;
  /** Numbered ID badge identifier — PFRA-aligned fundraisers carry
   *  these. Useful for the verdict screen even though the engine
   *  doesn't currently look it up. */
  badge_number?: string;
  /** Free-text notes the model surfaced — anything else printed that
   *  might help the donor (e.g. campaign name, expiry date on the badge). */
  notes?: string;
  /** True when the model successfully extracted at least one field. */
  extracted: boolean;
}

const SYSTEM_PROMPT = `You read photos of Australian charity fundraiser materials — ID badges, lanyards, flyers, donation request cards. Extract structured fields STRICTLY from what's visibly printed in the image. Never invent or infer.

Return JSON ONLY with this schema (omit fields you can't read cleanly):
{
  "charity_name": "string — exact text as printed",
  "abn": "11 digits, no spaces/dashes",
  "acnc_number": "exact text",
  "agency_name": "fundraising-agency name if printed (often a separate logo from the charity)",
  "badge_number": "the numeric ID on the lanyard badge",
  "notes": "anything else printed that might help — campaign, expiry, etc."
}

Rules:
- Output JSON only. No prose, no markdown fences.
- If the image isn't a charity-related photo, return {}.
- ABN: must be exactly 11 digits. If the photo shows fewer or more digits or the read is unclear, omit.
- Don't guess. If you can read the charity name but the ABN is blurred, omit ABN.
- Don't normalize charity names — copy them as printed (e.g. "St John's" not "St Johns").`;

const USER_PROMPT = `Read the visible text in this image and extract the structured fields per the system prompt. JSON only.`;

/** Validate that a model output is shaped like a LanyardExtraction. */
function parseExtraction(raw: string): LanyardExtraction {
  // Strip markdown fences if the model wrapped despite instructions.
  const cleaned = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { extracted: false };
  }
  if (!parsed || typeof parsed !== "object") return { extracted: false };
  const obj = parsed as Record<string, unknown>;
  const str = (k: string): string | undefined => {
    const v = obj[k];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  };

  const out: LanyardExtraction = {
    charity_name: str("charity_name"),
    abn: str("abn"),
    acnc_number: str("acnc_number"),
    agency_name: str("agency_name"),
    badge_number: str("badge_number"),
    notes: str("notes"),
    extracted: false,
  };
  // Validate ABN — strip non-digits and require exactly 11.
  if (out.abn) {
    const digits = out.abn.replace(/\D/g, "");
    out.abn = digits.length === 11 ? digits : undefined;
  }
  out.extracted = Boolean(
    out.charity_name || out.abn || out.acnc_number || out.agency_name || out.badge_number,
  );
  return out;
}

/**
 * Extract structured charity fields from a base64-encoded image of a
 * fundraiser's ID badge / lanyard / flyer.
 *
 * `imageMediaType` is the MIME type as detected by the route's magic-byte
 * validator (e.g. 'image/jpeg', 'image/png'). `imageBase64` is the raw
 * base64 string WITHOUT the `data:image/…;base64,` prefix.
 *
 * Returns an extraction object — every field optional. `extracted=false`
 * when the model couldn't read anything useful or the API call failed.
 * Never throws; failure logs and returns an empty extraction.
 */
export async function ocrLanyard(
  imageBase64: string,
  imageMediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp",
): Promise<LanyardExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn("ocr-lanyard: ANTHROPIC_API_KEY missing");
    return { extracted: false };
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: imageMediaType,
                  data: imageBase64,
                },
              },
              { type: "text", text: USER_PROMPT },
            ],
          },
        ],
      },
      { timeout: 15_000 },
    );

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      logger.warn("ocr-lanyard: no text block in Claude response");
      return { extracted: false };
    }

    return parseExtraction(textBlock.text);
  } catch (err) {
    logger.warn("ocr-lanyard: Claude call failed", { error: String(err) });
    return { extracted: false };
  }
}

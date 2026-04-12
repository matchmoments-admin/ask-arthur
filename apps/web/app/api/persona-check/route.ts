import { NextRequest, NextResponse } from "next/server";
import { logger } from "@askarthur/utils/logger";
import { checkRateLimit } from "@askarthur/utils/rate-limit";
import { scrubPII } from "@askarthur/scam-engine/pipeline";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";

const PersonaSchema = z.object({
  text: z.string().min(10).max(10000),
  type: z.enum(["romance", "employment", "general"]),
});

const PERSONA_SYSTEM_PROMPT = `You are Arthur, an Australian scam detection AI specialised in verifying whether online personas are legitimate or fraudulent.

You will receive:
1. A persona type (romance, employment, or general)
2. User-submitted content (profile text, messages, job listings, descriptions)

Analyse the content for signs of fraud. Consider:

FOR ROMANCE SCAMS:
- Love-bombing language (excessive flattery, rushing intimacy)
- Financial requests (crypto, wire transfer, gift cards)
- Avoidance of video calls or in-person meetings
- Inconsistent personal details or timeline
- Stolen photo indicators (model-quality photos, few candid shots)
- Profile created recently with few connections

FOR EMPLOYMENT SCAMS:
- Unsolicited job offers with unrealistic pay
- Requests for upfront payments (training, equipment, visa fees)
- Vague company details or unverifiable business
- Communication only via messaging apps (not official email)
- AI-generated resume or credentials
- Remote work "opportunity" requiring software downloads

FOR ALL TYPES:
- Urgency and pressure tactics
- Requests for personal information (ID, bank details, passwords)
- Inconsistencies in story or background
- Too-good-to-be-true promises
- Communication patterns typical of scam scripts

Return JSON with this exact structure:
{
  "verdict": "SAFE" | "UNCERTAIN" | "SUSPICIOUS" | "HIGH_RISK",
  "confidence": 0.0-1.0,
  "riskLevel": "Low Risk" | "Some Concerns" | "Warning Signs" | "High Risk",
  "summary": "1-2 sentence plain-language assessment",
  "redFlags": ["specific red flag 1", "specific red flag 2"],
  "greenFlags": ["positive signal 1"],
  "recommendations": ["what the user should do next"],
  "inferredType": "romance" | "employment" | "investment" | "general"
}

Be empathetic but honest. Use Australian English. Never say definitively "this IS a scam" — use probabilistic language like "shows strong indicators of" or "has characteristics consistent with".`;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for") || "unknown";
    const ua = req.headers.get("user-agent") || "unknown";
    const rl = await checkRateLimit(ip, ua);
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    const body = await req.json();
    const parsed = PersonaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input." }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Service unavailable." }, { status: 503 });
    }

    const scrubbed = scrubPII(parsed.data.text);

    // If input is just a URL with minimal text, ask for more detail
    const isJustUrl = /^https?:\/\/\S+$/.test(scrubbed.trim());
    if (isJustUrl) {
      return NextResponse.json({
        verdict: "UNCERTAIN",
        confidence: 0.3,
        riskLevel: "Insufficient Information",
        summary: "A URL alone isn't enough for a thorough persona check. Please paste the person's profile text, messages, or describe the situation in detail.",
        redFlags: [],
        greenFlags: [],
        recommendations: [
          "Copy and paste the person's profile bio or 'About' section",
          "Include any messages or chat history you've received",
          "Describe how you met and what they've asked you to do",
        ],
        inferredType: parsed.data.type,
      });
    }

    let responseText: string;
    try {
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system: PERSONA_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Persona type: ${parsed.data.type}\n\nContent to analyse:\n${scrubbed}`,
          },
        ],
      });
      responseText = response.content[0]?.type === "text" ? response.content[0].text : "";
    } catch (claudeErr) {
      logger.error("Claude API call failed", { error: String(claudeErr) });
      return NextResponse.json({ error: "Analysis service temporarily unavailable. Please try again." }, { status: 503 });
    }

    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.error("Persona check: no JSON in response", { text: responseText.slice(0, 200) });
      return NextResponse.json({ error: "Analysis failed — please try again." }, { status: 500 });
    }

    let result: Record<string, unknown>;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch {
      logger.error("Persona check: invalid JSON", { text: jsonMatch[0].slice(0, 200) });
      return NextResponse.json({ error: "Analysis failed — please try again." }, { status: 500 });
    }

    // Validate required fields
    if (!result.verdict || !result.summary) {
      return NextResponse.json({ error: "Analysis incomplete — please try again." }, { status: 500 });
    }

    return NextResponse.json({
      verdict: result.verdict,
      confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0.5)),
      riskLevel: result.riskLevel || "Unknown",
      summary: String(result.summary).slice(0, 500),
      redFlags: Array.isArray(result.redFlags) ? result.redFlags.slice(0, 10) : [],
      greenFlags: Array.isArray(result.greenFlags) ? result.greenFlags.slice(0, 5) : [],
      recommendations: Array.isArray(result.recommendations) ? result.recommendations.slice(0, 5) : [],
      inferredType: result.inferredType || parsed.data.type,
    });
  } catch (err) {
    logger.error("Persona check error", { error: String(err) });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed." },
      { status: 500 }
    );
  }
}

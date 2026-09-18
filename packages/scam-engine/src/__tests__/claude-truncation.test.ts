/**
 * max_tokens truncation in analyzeWithClaude (incident 2026-09-17).
 *
 * A forward to scan@askarthur.au produced a complete verdict, summary, red
 * flags and next steps — then hit the 700-token cap inside the trailing
 * `scammerContacts` block. `analyzeWithClaude` never looked at
 * `stop_reason`; its `\{[\s\S]*\}` extraction ran to the last `}` (an array
 * element's closing brace) and JSON.parse threw "Expected ',' or ']' after
 * array element". The route classified that as non-transient and sent the
 * user a "temporarily overloaded" apology instead of the verdict it already
 * had. Reproduced 10/10 against the live model on the real email; the
 * verdict was recoverable from the truncated text every time.
 *
 * The fixture below mirrors a real captured Haiku output for that email,
 * cut at the shape prod reported — mid-string, inside
 * `scammerContacts.emailAddresses[]`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mockCreate };
  },
}));

import { analyzeWithClaude } from "../claude";

// Text as the API returns it — WITHOUT the leading "{" (that is the
// assistant prefill, re-attached by analyzeWithClaude).
const COMPLETE_BODY = `
  "verdict": "HIGH_RISK",
  "confidence": 0.95,
  "summary": "This looks like a phishing email impersonating Australia Post. Do not click the links or reply.",
  "redFlags": [
    "Vague reference to 'overdue accounts' that Australia Post would not raise by email",
    "Generic greeting rather than your name",
    "Pressure to act on a case you did not open"
  ],
  "nextSteps": [
    "Do not click any links in the email",
    "Go to auspost.com.au directly and log in there",
    "Call Australia Post on 13 76 78 to confirm"
  ],
  "scamType": "phishing",
  "impersonatedBrand": "Australia Post",
  "channel": "email",
  "scammerContacts": {
    "phoneNumbers": [],
    "emailAddresses": [
      {
        "value": "[EMAIL] (redacted — sender address)",
        "context": "Sender of the phishing email — not an official Australia Post domain"
      },
      {
        "value": "[EMAIL] (redacted — reply-to address in the body)",
        "context": "Address the email asks you to write to"
      }
    ]
  }
}`;

// Cut mid-string inside emailAddresses[1] — the shape prod saw.
const TRUNCATED_BODY = COMPLETE_BODY.slice(
  0,
  COMPLETE_BODY.indexOf('"value": "[EMAIL] (redacted — reply-to') + 30,
);

function apiResponse(text: string, stopReason: "end_turn" | "max_tokens") {
  return {
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    usage: {
      input_tokens: 2706,
      output_tokens: stopReason === "max_tokens" ? 700 : 480,
      cache_read_input_tokens: 0,
    },
  };
}

beforeEach(() => {
  mockCreate.mockReset();
  process.env.ANTHROPIC_API_KEY = "test-key";
});

describe("analyzeWithClaude at max_tokens", () => {
  it("still returns the verdict when the cut lands inside scammerContacts", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(TRUNCATED_BODY, "max_tokens"));

    const result = await analyzeWithClaude("Subject: FW: Australia Post case", undefined, "text");

    expect(result.verdict).toBe("HIGH_RISK");
    expect(result.confidence).toBe(0.95);
    expect(result.summary).toMatch(/impersonating Australia Post/);
    expect(result.redFlags).toHaveLength(3);
    expect(result.nextSteps).toHaveLength(3);
    // The one complete contact survives; the half-written one is dropped
    // rather than shipped as a partial string.
    expect(result.scammerContacts?.emailAddresses ?? []).toHaveLength(1);
    expect(result.usage?.outputTokens).toBe(700);
  });

  it("is a no-op on a normal end_turn completion", async () => {
    mockCreate.mockResolvedValueOnce(apiResponse(COMPLETE_BODY, "end_turn"));

    const result = await analyzeWithClaude("Subject: FW: Australia Post case", undefined, "text");

    expect(result.verdict).toBe("HIGH_RISK");
    expect(result.scammerContacts?.emailAddresses).toHaveLength(2);
  });

  it("throws a truncation error (not a JSON syntax error) when the cut precedes the verdict", async () => {
    // Cut inside the verdict value itself — nothing usable exists yet.
    const tooEarly = COMPLETE_BODY.slice(0, COMPLETE_BODY.indexOf("HIGH_RISK") + 4);
    mockCreate.mockResolvedValueOnce(apiResponse(tooEarly, "max_tokens"));

    await expect(
      analyzeWithClaude("Subject: FW: Australia Post case", undefined, "text"),
    ).rejects.toThrow(/truncated at max_tokens/);
  });
});

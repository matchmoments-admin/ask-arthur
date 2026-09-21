import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askJev } from "../providers/jev";

// Each failure branch must land on the right discriminator: the clone-watch
// shadow step keys its $0 diagnostic row on `reason`, and `rate_limited`
// must stay distinct from `http_error` (quota exhaustion is not a dead
// vendor — CLAUDE.md, clone-watch incident 2026-07-12).

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.TYPESAFE_API_KEY;

const QUESTIONS = {
  is_clone: { type: "noul" as const, instructions: "Is it a clone?" },
  tactic: {
    type: "choice" as const,
    instructions: "Which tactic?",
    criteria: { typosquat: "one char off", unrelated: "coincidence" },
  },
};

const GOOD_BODY = {
  model: "jev-1.13.0",
  answers: {
    is_clone: { type: "noul", noul: 0.91 },
    tactic: {
      type: "choice",
      choice: "typosquat",
      probabilities: { typosquat: 0.8, unrelated: 0.2 },
      confidence: 0.6,
    },
  },
  usage: { input_tokens: 120, output_tokens: 0 },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("askJev", () => {
  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = "test-key";
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = ORIGINAL_KEY;
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it("returns no-key without calling fetch when the env var is absent", async () => {
    delete process.env.TYPESAFE_API_KEY;
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const res = await askJev("state", QUESTIONS);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no-key");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs bearer auth + jev-latest + the questions verbatim", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(GOOD_BODY));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    await askJev({ brand: "nab.com.au" }, QUESTIONS);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      state: { brand: "nab.com.au" },
      model: "jev-latest",
      questions: QUESTIONS,
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("parses a well-formed response into answers + model + usage", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(GOOD_BODY)) as unknown as typeof fetch;

    const res = await askJev("state", QUESTIONS);

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.model).toBe("jev-1.13.0");
      expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 0 });
      const isClone = res.answers.is_clone;
      expect(isClone?.type).toBe("noul");
      if (isClone?.type === "noul") expect(isClone.noul).toBe(0.91);
      const tactic = res.answers.tactic;
      if (tactic?.type === "choice") {
        expect(tactic.choice).toBe("typosquat");
        expect(tactic.probabilities.unrelated).toBe(0.2);
      } else {
        throw new Error("expected choice answer");
      }
      expect(res.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("maps 429 to rate_limited (not http_error)", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("slow down", { status: 429 }),
      ) as unknown as typeof fetch;

    const res = await askJev("state", QUESTIONS);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("rate_limited");
      expect(res.status).toBe(429);
    }
  });

  it("maps 401 to http_error with the status attached", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ detail: { error_type: "authentication_error" } }, 401),
      ) as unknown as typeof fetch;

    const res = await askJev("state", QUESTIONS);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe("http_error");
      expect(res.status).toBe(401);
    }
  });

  it("maps a non-JSON 200 body to bad_shape", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("<html>oops</html>", { status: 200 }),
      ) as unknown as typeof fetch;

    const res = await askJev("state", QUESTIONS);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_shape");
  });

  it("maps a JSON body with an answer of unknown type to bad_shape", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        ...GOOD_BODY,
        answers: { is_clone: { type: "vibe", vibe: 1 } },
      }),
    ) as unknown as typeof fetch;

    const res = await askJev("state", QUESTIONS);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("bad_shape");
  });

  it("maps an AbortSignal timeout to timeout", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new DOMException("The operation timed out", "TimeoutError"),
      ) as unknown as typeof fetch;

    const res = await askJev("state", QUESTIONS);

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("timeout");
  });

  it("maps a network failure to http_error and never throws", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(
        new TypeError("fetch failed"),
      ) as unknown as typeof fetch;

    await expect(askJev("state", QUESTIONS)).resolves.toMatchObject({
      ok: false,
      reason: "http_error",
    });
  });
});

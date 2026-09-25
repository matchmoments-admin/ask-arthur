import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import worker, { quarantine, summariseAuthResults } from "./index";

const RAW = [
  "From: Alice <alice@example.com>",
  "To: scan@askarthur-inbound.com",
  "Subject: Is this a scam?",
  "Message-ID: <abc@example.com>",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Please check https://example.com/login",
  "",
].join("\r\n");

function fakeMessage(opts: { raw?: string | ReadableStream; authResults?: string; forward?: ReturnType<typeof vi.fn> } = {}) {
  const raw =
    opts.raw instanceof ReadableStream ? opts.raw : new Response(opts.raw ?? RAW).body!;
  const headers = new Headers({ "message-id": "<abc@example.com>" });
  if (opts.authResults) headers.set("authentication-results", opts.authResults);
  return {
    to: "scan@askarthur-inbound.com",
    from: "alice@example.com",
    raw,
    rawSize: RAW.length,
    headers,
    forward: opts.forward ?? vi.fn().mockResolvedValue(undefined),
    setReject: vi.fn(),
    reply: vi.fn(),
  };
}

const baseEnv = {
  INBOUND_EMAIL_WEBHOOK_SECRET: "s",
  SUPABASE_EDGE_FUNCTION_URL: "https://edge.example/intel",
  SCAN_REPORT_ENDPOINT_URL: "https://askarthur.example/api/inbound-scan",
  QUARANTINE_ADDRESS: "ops@askarthur.au",
};

const run = (msg: ReturnType<typeof fakeMessage>, env: Record<string, unknown> = baseEnv) =>
  (worker as unknown as { email: (m: unknown, e: unknown, c: unknown) => Promise<void> }).email(
    msg,
    env,
    {},
  );

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("quarantine()", () => {
  it("forwards to the configured address with a reason header", async () => {
    const msg = fakeMessage();
    expect(await quarantine(msg as never, baseEnv, "upstream_503")).toBe(true);
    expect(msg.forward).toHaveBeenCalledWith("ops@askarthur.au", expect.any(Headers));
    const headers = msg.forward.mock.calls[0]![1] as Headers;
    expect(headers.get("X-AskArthur-Quarantine-Reason")).toBe("upstream_503");
  });

  it("logs loudly and does not throw when the address is unset", async () => {
    const msg = fakeMessage();
    expect(await quarantine(msg as never, {}, "parse_failed")).toBe(false);
    expect(msg.forward).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("QUARANTINE_ADDRESS unset"),
      expect.objectContaining({ reason: "parse_failed" }),
    );
  });

  it("logs (never swallows silently) a forward rejection", async () => {
    const msg = fakeMessage({ forward: vi.fn().mockRejectedValue(new Error("destination not verified")) });
    expect(await quarantine(msg as never, baseEnv, "fetch_threw")).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("quarantine forward failed"),
      expect.objectContaining({ err: "destination not verified" }),
    );
  });
});

describe("email() failure paths quarantine", () => {
  it("5xx from the scan endpoint forwards the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("down", { status: 503 })));
    const msg = fakeMessage();
    await run(msg);
    expect(msg.forward).toHaveBeenCalledWith("ops@askarthur.au", expect.any(Headers));
    expect((msg.forward.mock.calls[0]![1] as Headers).get("X-AskArthur-Quarantine-Reason")).toBe(
      "upstream_503",
    );
  });

  it("4xx is logged but NOT quarantined (contract bug, not transient)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("bad", { status: 422 })));
    const msg = fakeMessage();
    await run(msg);
    expect(msg.forward).not.toHaveBeenCalled();
  });

  it("a thrown fetch forwards the message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const msg = fakeMessage();
    await run(msg);
    expect((msg.forward.mock.calls[0]![1] as Headers).get("X-AskArthur-Quarantine-Reason")).toBe(
      "fetch_threw",
    );
  });

  it("a missing scan endpoint forwards the message", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const msg = fakeMessage();
    await run(msg, { ...baseEnv, SCAN_REPORT_ENDPOINT_URL: undefined });
    expect((msg.forward.mock.calls[0]![1] as Headers).get("X-AskArthur-Quarantine-Reason")).toBe(
      "scan_endpoint_missing",
    );
  });

  it("an unreadable raw stream forwards the message (parse_failed)", async () => {
    const broken = new ReadableStream({
      start(c) {
        c.error(new Error("stream broke"));
      },
    });
    const msg = fakeMessage({ raw: broken });
    await run(msg);
    expect((msg.forward.mock.calls[0]![1] as Headers).get("X-AskArthur-Quarantine-Reason")).toBe(
      "parse_failed",
    );
  });

  it("a delivered message is parsed from the buffered raw and not quarantined", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const msg = fakeMessage();
    await run(msg);
    expect(msg.forward).not.toHaveBeenCalled();
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toMatchObject({ source: "inbound_scan", subject: "Is this a scam?" });
  });
});

describe("summariseAuthResults()", () => {
  it("extracts method verdicts only", () => {
    expect(
      summariseAuthResults(
        "mx.cloudflare.net; dkim=pass header.d=example.com header.s=s1; spf=pass (mx.cloudflare.net: domain of alice@example.com designates 1.2.3.4) smtp.mailfrom=alice@example.com; dmarc=pass header.from=example.com",
      ),
    ).toEqual({ present: true, spf: "pass", dkim: "pass", dmarc: "pass" });
  });

  it("returns nulls when absent", () => {
    expect(summariseAuthResults(null)).toEqual({ present: false, spf: null, dkim: null, dmarc: null });
  });

  it("reports failures and missing methods", () => {
    expect(summariseAuthResults("mx.example; spf=softfail smtp.mailfrom=x@y; dmarc=fail")).toEqual({
      present: true,
      spf: "softfail",
      dkim: null,
      dmarc: "fail",
    });
  });

  it("does not match a method name embedded in another token", () => {
    expect(summariseAuthResults("mx; x-dkim=pass; arc=none").dkim).toBeNull();
  });

  it("the received log line carries the summary, never the raw header", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(fakeMessage({ authResults: "mx; spf=pass smtp.mailfrom=alice@example.com; dmarc=pass" }));
    const received = logSpy.mock.calls.find((c) => c[0] === "inbound-email: received")!;
    expect(received[1]).toMatchObject({ auth_results: { present: true, spf: "pass", dmarc: "pass" } });
    expect(JSON.stringify(received[1].auth_results)).not.toContain("alice@example.com");
  });
});

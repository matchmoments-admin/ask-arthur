import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadMessengerAttachment } from "@/lib/bots/messenger/media";

afterEach(() => vi.unstubAllGlobals());

function streamedImage(bytes: number) {
  const chunk = new Uint8Array(1024 * 1024);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (sent >= bytes) return ctrl.close();
      sent += chunk.byteLength;
      ctrl.enqueue(chunk);
    },
  });
  // No Content-Length: the old code buffered everything before checking size.
  return new Response(stream, { headers: { "content-type": "image/png" } });
}

describe("downloadMessengerAttachment", () => {
  it("returns base64 for an image under the cap, via the SSRF-safe dispatcher with a timeout", async () => {
    const fetchMock = vi.fn(async () => streamedImage(1024 * 1024));
    vi.stubGlobal("fetch", fetchMock);
    expect(await downloadMessengerAttachment("https://cdn.example/a.png")).toBeTypeOf("string");
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { dispatcher?: unknown; signal?: unknown };
    expect(init.dispatcher).toBeDefined();
    expect(init.signal).toBeDefined();
  });

  it("refuses an oversize body that declares no Content-Length", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamedImage(8 * 1024 * 1024)));
    expect(await downloadMessengerAttachment("https://cdn.example/big.png")).toBeNull();
  });
});

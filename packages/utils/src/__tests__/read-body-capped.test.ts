import { describe, expect, it } from "vitest";
import { readBodyCapped, readTextCapped } from "../read-body-capped";

function streamed(chunks: number[], headers: Record<string, string> = {}) {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (pulled >= chunks.length) return ctrl.close();
      ctrl.enqueue(new Uint8Array(chunks[pulled++]!));
    },
  });
  return { res: new Response(stream, { headers }), pulled: () => pulled };
}

describe("readBodyCapped", () => {
  it("returns the whole body under the cap", async () => {
    const { res } = streamed([10, 20]);
    const r = await readBodyCapped(res, 100);
    expect(r).toMatchObject({ ok: true, truncated: false });
    expect(r.ok && r.bytes.byteLength).toBe(30);
  });

  it("stops reading as soon as the cap is exceeded, with no Content-Length", async () => {
    const s = streamed([60, 60, 60, 60, 60]);
    const r = await readBodyCapped(s.res, 100);
    expect(r).toEqual({ ok: false, reason: "too_large" });
    expect(s.pulled()).toBeLessThanOrEqual(3);
  });

  it("rejects a declared Content-Length above the cap without reading", async () => {
    const s = streamed([10], { "content-length": "5000" });
    expect(await readBodyCapped(s.res, 100)).toEqual({ ok: false, reason: "too_large" });
  });

  it("decodes text", async () => {
    expect(await readTextCapped(new Response("héllo"), 100)).toBe("héllo");
    expect(await readTextCapped(new Response("x".repeat(200)), 100)).toBeNull();
  });
});

describe("readBodyCapped — truncate mode", () => {
  it("keeps exactly the first maxBytes and stops pulling", async () => {
    const s = streamed([60, 60, 60, 60, 60], { "content-length": "300" });
    const r = await readBodyCapped(s.res, 100, { truncate: true });
    expect(r).toMatchObject({ ok: true, truncated: true });
    expect(r.ok && r.bytes.byteLength).toBe(100);
    expect(s.pulled()).toBeLessThanOrEqual(3);
  });
});

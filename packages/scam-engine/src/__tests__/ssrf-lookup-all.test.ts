import type { LookupFunction } from "node:net";
import { describe, expect, it } from "vitest";
import { buildSsrfLookup } from "../ssrf-dispatcher";

// With autoSelectFamily (Node 20+ default), undici asks for ALL addresses and
// may dial any of them. A mixed answer must be refused outright.
function stub(addresses: Array<{ address: string; family: number }>): LookupFunction {
  return ((_h: string, _o: unknown, cb: (e: null, a: unknown, f?: number) => void) =>
    cb(null, addresses)) as unknown as LookupFunction;
}

function run(lookup: LookupFunction) {
  return new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>((resolve) =>
    lookup("mixed.example", { all: true }, (err, address) => resolve({ err, address })),
  );
}

describe("buildSsrfLookup — all:true answers", () => {
  it("rejects when ANY returned address is private", async () => {
    const r = await run(
      buildSsrfLookup(stub([{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }])),
    );
    expect(r.err?.code).toBe("EPRIVATEHOST");
  });

  it("rejects a private address in the IPv6 half of a dual-stack answer", async () => {
    const r = await run(
      buildSsrfLookup(stub([{ address: "93.184.216.34", family: 4 }, { address: "::1", family: 6 }])),
    );
    expect(r.err?.code).toBe("EPRIVATEHOST");
  });

  it("passes an all-public answer through unchanged", async () => {
    const list = [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }];
    const r = await run(buildSsrfLookup(stub(list)));
    expect(r.err).toBeNull();
    expect(r.address).toEqual(list);
  });

  it("rejects an empty answer", async () => {
    expect((await run(buildSsrfLookup(stub([])))).err?.code).toBe("EPRIVATEHOST");
  });
});

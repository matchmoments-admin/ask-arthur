import { describe, expect, it } from "vitest";
import { isBridgeMessage } from "@/lib/turnstile-bridge";

const BRIDGE = "https://askarthur.au/extension-turnstile";
const frame = {} as Window;
const other = {} as Window;

describe("isBridgeMessage", () => {
  it("accepts the bridge origin from the bridge frame", () => {
    expect(isBridgeMessage({ origin: "https://askarthur.au", source: frame }, BRIDGE, frame)).toBe(true);
  });

  it.each([
    ["another origin", { origin: "https://example.com", source: frame }],
    ["a lookalike origin", { origin: "https://askarthur.au.example.com", source: frame }],
    ["the right origin from another window", { origin: "https://askarthur.au", source: other }],
    ["a null source", { origin: "https://askarthur.au", source: null }],
  ])("rejects %s", (_label, event) => {
    expect(isBridgeMessage(event as Pick<MessageEvent, "origin" | "source">, BRIDGE, frame)).toBe(false);
  });

  it("rejects when the frame isn't there", () => {
    expect(isBridgeMessage({ origin: "https://askarthur.au", source: frame }, BRIDGE, null)).toBe(false);
  });
});

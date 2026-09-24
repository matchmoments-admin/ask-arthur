import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/keys?tab=1#top", "/app/keys?tab=1#top"],
    ["/invite/abc", "/invite/abc"],
    ["/a/../b", "/b"],
  ])("keeps same-origin path %s", (input, out) => {
    expect(safeNextPath(input)).toBe(out);
  });

  it.each([
    "@evil.example",
    ".evil.example",
    "evil.example",
    "//evil.example",
    "//evil.example/app",
    "/\\evil.example",
    "\\\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "/\t/evil.example",
    "/\n/evil.example",
    "",
    null,
    undefined,
    "/" + "a".repeat(3000),
    // Dot segments that normalise into a protocol-relative path.
    "/.//evil.example",
    "/..//evil.example",
    "/a/..//evil.example",
    "/%2e//evil.example",
    "/%2e%2e//evil.example",
    "/././/evil.example",
  ])("falls back for %j", (input) => {
    expect(safeNextPath(input as string | null | undefined)).toBe("/app");
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("//x", "/login")).toBe("/login");
  });

  it("never yields an off-origin URL when joined to an origin", () => {
    for (const input of ["@evil.example", "//evil.example", "/\\evil.example", "/%2F%2Fevil.example", "/.//evil.example", "/..//evil.example"]) {
      const url = new URL(safeNextPath(input), "https://askarthur.au");
      expect(url.origin).toBe("https://askarthur.au");
    }
  });
});

// Generated inputs: every combination of hostile fragments must stay on-origin
// once joined to the site origin, and the output must be a fixed point.
describe("safeNextPath — generated inputs", () => {
  const parts = ["/", "//", ".", "..", "%2e", "%2E", "%2f", "%5c", "\\", "@", "evil.example", "?", "#", ":", "a"];
  const inputs: string[] = [];
  for (const a of parts) for (const b of parts) for (const c of parts) inputs.push(`/${a}${b}${c}`);

  it.each(["https://askarthur.au", "http://localhost:3000"])("stays on %s", (origin) => {
    for (const input of inputs) {
      const out = safeNextPath(input);
      expect(new URL(out, origin).origin, input).toBe(origin);
      expect(safeNextPath(out), input).toBe(out);
    }
  });
});

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
  ])("falls back for %j", (input) => {
    expect(safeNextPath(input as string | null | undefined)).toBe("/app");
  });

  it("uses the caller's fallback", () => {
    expect(safeNextPath("//x", "/login")).toBe("/login");
  });

  it("never yields an off-origin URL when joined to an origin", () => {
    for (const input of ["@evil.example", "//evil.example", "/\\evil.example", "/%2F%2Fevil.example"]) {
      const url = new URL(safeNextPath(input), "https://askarthur.au");
      expect(url.origin).toBe("https://askarthur.au");
    }
  });
});

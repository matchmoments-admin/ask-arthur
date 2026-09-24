import { describe, expect, it } from "vitest";
import { pageHost } from "@/lib/page-host";
import { jsonLdScript } from "@/lib/json-ld";

describe("pageHost", () => {
  it.each([
    ["https://www.facebook.com/messages/t/123456?x=tok#y", "https://www.facebook.com"],
    ["http://example.com:8080/a/b", "http://example.com:8080"],
    ["https://mail.google.com/mail/u/0/#inbox/FMfcg", "https://mail.google.com"],
  ])("keeps only the origin of %s", (input, out) => {
    expect(pageHost(input)).toBe(out);
  });

  it.each([null, undefined, "", "not a url", "javascript:alert(1)", "file:///etc/passwd"])(
    "returns null for %j",
    (input) => {
      expect(pageHost(input as string | null | undefined)).toBeNull();
    },
  );
});

describe("jsonLdScript", () => {
  it("never emits a raw '<' so a value cannot close the script element", () => {
    const out = jsonLdScript({ headline: "</script><img src=x>", n: 1 });
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c/script>");
  });

  it("round-trips to the same data", () => {
    const data = { headline: "a < b </script>", arr: ["\u2028", "x"] };
    expect(JSON.parse(jsonLdScript(data))).toEqual(data);
  });
});

import { describe, it, expect } from "vitest";
import { assertSafeURL, filterSafeURLs } from "../ssrf-guard";

// Regression cover for the 2026-07-29 review finding: `assertSafeURL` carried
// its own copy of the private-range list, and that copy was DEAD for every
// IPv6 form. `URL.hostname` returns IPv6 literals bracketed (`[::1]`), so the
// unbracketed `/^::1$/` and `/^fe80:/` patterns could never match. The guard
// now delegates to `isPrivateIP` (./private-ip), the shared classifier that
// strips brackets and decodes IPv4-mapped addresses.

describe("assertSafeURL", () => {
  describe("IPv6 — the forms the old inline blocklist could not match", () => {
    const blocked = [
      ["bracketed loopback", "http://[::1]/"],
      [
        "IPv4-mapped metadata, dotted",
        "http://[::ffff:169.254.169.254]/latest/meta-data/",
      ],
      ["IPv4-mapped metadata, hex", "http://[::ffff:a9fe:a9fe]/"],
      ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/"],
      ["link-local", "http://[fe80::1]/"],
      ["unique local fc00::/7", "http://[fc00::1]/"],
      ["unique local fd00::/8", "http://[fd12:3456::1]/"],
      ["unspecified", "http://[::]/"],
    ] as const;

    for (const [label, url] of blocked) {
      it(`blocks ${label}`, () => {
        expect(() => assertSafeURL(url)).toThrow(/Blocked/);
      });
    }

    it("still allows a public IPv6 literal", () => {
      expect(() =>
        assertSafeURL("http://[2606:4700:4700::1111]/"),
      ).not.toThrow();
    });
  });

  describe("IPv4 — behaviour preserved from the inline list", () => {
    const blocked = [
      "http://127.0.0.1/",
      "http://10.0.0.1/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://169.254.169.254/latest/meta-data/",
      "http://0.0.0.0/",
    ];

    for (const url of blocked) {
      it(`blocks ${url}`, () => {
        expect(() => assertSafeURL(url)).toThrow(/Blocked/);
      });
    }
  });

  describe("hostnames and schemes", () => {
    it("blocks localhost", () => {
      expect(() => assertSafeURL("http://localhost:3000/")).toThrow(
        /Blocked host/,
      );
    });

    it("blocks the GCP metadata hostname", () => {
      expect(() => assertSafeURL("http://metadata.google.internal/")).toThrow(
        /Blocked host/,
      );
    });

    it("blocks non-http(s) schemes", () => {
      expect(() => assertSafeURL("file:///etc/passwd")).toThrow(
        /Blocked scheme/,
      );
      expect(() => assertSafeURL("gopher://example.com/")).toThrow(
        /Blocked scheme/,
      );
    });

    // Node's URL parser normalises both of these to 127.0.0.1 before the
    // guard sees them, so they are caught by the IP-range branch rather than
    // the notation branch. The notation checks remain as defence in depth for
    // any form the parser leaves alone. Assert on the outcome, not the reason.
    it("blocks decimal and hex IP notation", () => {
      expect(() => assertSafeURL("http://2130706433/")).toThrow(/Blocked/);
      expect(() => assertSafeURL("http://0x7f000001/")).toThrow(/Blocked/);
    });

    it("throws on an unparseable URL", () => {
      expect(() => assertSafeURL("not a url")).toThrow(/Invalid URL/);
    });

    it("allows an ordinary public URL", () => {
      expect(() => assertSafeURL("https://askarthur.au/check")).not.toThrow();
      expect(() => assertSafeURL("http://example.com/a?b=c")).not.toThrow();
    });
  });
});

describe("filterSafeURLs", () => {
  it("silently drops unsafe entries and keeps the rest in order", () => {
    expect(
      filterSafeURLs([
        "https://example.com/one",
        "http://[::ffff:169.254.169.254]/",
        "https://example.org/two",
        "http://127.0.0.1/",
      ]),
    ).toEqual(["https://example.com/one", "https://example.org/two"]);
  });
});

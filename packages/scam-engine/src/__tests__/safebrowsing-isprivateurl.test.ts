import { describe, expect, it } from "vitest";
import { isPrivateURL } from "../safebrowsing";

describe("isPrivateURL — IPv6 literal hosts (the /ultracode SSRF gaps)", () => {
  it.each([
    "http://[::1]/", //                       loopback
    "http://[::]/", //                        unspecified
    "http://[fd00::1]/", //                   ULA
    "http://[fe80::1]/", //                   link-local
    "http://[::ffff:169.254.169.254]/", //    IPv4-mapped cloud metadata
    "http://[::ffff:127.0.0.1]/", //          IPv4-mapped loopback
  ])("blocks %s", (url) => expect(isPrivateURL(url)).toBe(true));

  it.each([
    "http://[2606:4700:4700::1111]/", //      public Cloudflare DNS
    "http://[2001:4860:4860::8888]/", //      public Google DNS
  ])("allows public %s", (url) => expect(isPrivateURL(url)).toBe(false));
});

describe("isPrivateURL — IPv4 + notation guards still hold (regression)", () => {
  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "http://2130706433/", //   decimal 127.0.0.1
    "http://0x7f000001/", //   hex 127.0.0.1
    "ftp://example.com/", //   non-http scheme
    "http://localhost/",
  ])("blocks %s", (url) => expect(isPrivateURL(url)).toBe(true));

  it.each(["https://example.com/", "https://askarthur.au/path"])(
    "allows public %s",
    (url) => expect(isPrivateURL(url)).toBe(false),
  );
});

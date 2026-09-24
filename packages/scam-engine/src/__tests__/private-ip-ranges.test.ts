import { describe, expect, it } from "vitest";
import { isPrivateIP } from "../private-ip";

describe("isPrivateIP — reserved and embedded-IPv4 ranges", () => {
  it.each([
    "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
    "192.0.0.8",
    "ff02::1",
    "64:ff9b::127.0.0.1", "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::", "2002:0a00:0001::1",
    "::127.0.0.1", "::7f00:1",
  ])("blocks %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each([
    "8.8.8.8", "93.184.216.34", "2606:4700::1111",
    "64:ff9b::8.8.8.8", "2002:0808:0808::1", "223.255.255.1",
  ])("allows public %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(false);
  });
});

// isPrivateURL passes HOSTNAMES through this classifier; IPv6 prefixes must
// not match ordinary names that happen to start with fc/fd/fe8/ff.
describe("isPrivateIP — hostnames are not IPv6 literals", () => {
  it.each(["fdic.gov", "fcbarcelona.com", "fe80.example", "ffmpeg.org"])("allows %s", (h) => {
    expect(isPrivateIP(h)).toBe(false);
  });
});

// IPv4 ranges must only match real dotted-quads — hostnames reach this
// classifier via isPrivateURL.
describe("isPrivateIP — hostnames that start like an IPv4 range", () => {
  it.each(["250.co", "247.ai", "224.example.com", "10.example.com", "127.example.org", "192.168.example.net", "169.254.example"])(
    "treats hostname %s as public",
    (h) => {
      expect(isPrivateIP(h)).toBe(false);
    },
  );
});

describe("isPrivateIP — IPv6 forms that embed or imply a private address", () => {
  it.each([
    "2002:a00::1", "2002:7f00::", "2002:c0a8:101::1", // compressed 6to4 → 10/8, 127/8, 192.168/16
    "64:ff9b:1::1", "64:ff9b:1:abcd::", // NAT64 local-use
    "2001:0:7f00:1::1", // Teredo server 127.0.0.1
    "2001:0:4136:e378:8000:63bf:f5ff:fffe", // Teredo client (inverted) 10.0.0.1
    "fec0::1", "feff::1", // site-local
    "::ffff:7f00:1", "0:0:0:0:0:ffff:127.0.0.1",
  ])("blocks %s", (ip) => {
    expect(isPrivateIP(ip)).toBe(true);
  });

  it.each(["2002:808:808::1", "2001:0:4136:e378:8000:63bf:f7f7:f7f7", "2606:4700::1111", "64:ff9b::808:808"])(
    "allows %s",
    (ip) => {
      expect(isPrivateIP(ip)).toBe(false);
    },
  );
});

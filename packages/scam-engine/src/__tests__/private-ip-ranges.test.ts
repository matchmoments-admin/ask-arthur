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

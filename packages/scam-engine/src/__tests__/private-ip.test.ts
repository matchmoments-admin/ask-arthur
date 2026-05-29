import { describe, expect, it } from "vitest";
import { isPrivateIP } from "../private-ip";

describe("isPrivateIP — IPv4", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "100.64.0.1", // CGNAT
  ])("blocks private %s", (ip) => expect(isPrivateIP(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "203.0.113.5"])(
    "allows public %s",
    (ip) => expect(isPrivateIP(ip)).toBe(false),
  );
});

describe("isPrivateIP — IPv6 (the /ultracode gaps)", () => {
  it.each([
    "::1", //                    loopback
    "[::1]", //                  bracketed loopback
    "::", //                     unspecified
    "[::]", //                   bracketed unspecified
    "fd00::1", //                ULA
    "[fd00::1]", //              bracketed ULA
    "fe80::1", //                link-local
    "[fe80::1]", //              bracketed link-local
    "::ffff:169.254.169.254", // IPv4-mapped (dotted) → metadata
    "::ffff:a9fe:a9fe", //       IPv4-mapped (hex)    → 169.254.169.254
    "::ffff:7f00:0001", //       IPv4-mapped (hex)    → 127.0.0.1
    "[::ffff:127.0.0.1]", //     bracketed mapped loopback
  ])("blocks private %s", (ip) => expect(isPrivateIP(ip)).toBe(true));

  it.each([
    "2606:4700:4700::1111", //   public (Cloudflare DNS)
    "::ffff:8.8.8.8", //         IPv4-mapped public
    "[2001:4860:4860::8888]", // bracketed public
  ])("allows public %s", (ip) => expect(isPrivateIP(ip)).toBe(false));
});

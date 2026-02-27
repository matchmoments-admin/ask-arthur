// TLS version probing — check for TLS 1.2/1.3 support and TLS 1.0/1.1 absence

import * as tls from "tls";
import type { CheckResult } from "../types";

type TLSVersion = "TLSv1" | "TLSv1.1" | "TLSv1.2" | "TLSv1.3";

/** Probe whether a specific TLS version connects successfully */
function probeTLS(
  domain: string,
  version: TLSVersion,
  timeoutMs: number = 3000
): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(false);
    }, timeoutMs);

    try {
      const socket = tls.connect(
        443,
        domain,
        {
          servername: domain,
          rejectUnauthorized: false,
          minVersion: version,
          maxVersion: version,
        },
        () => {
          clearTimeout(timeout);
          socket.destroy();
          resolve(true);
        }
      );

      socket.on("error", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(false);
      });
    } catch {
      clearTimeout(timeout);
      resolve(false);
    }
  });
}

/** Check TLS 1.2 support (required) */
export async function checkTLS12(domain: string): Promise<CheckResult> {
  const supported = await probeTLS(domain, "TLSv1.2");

  return {
    id: "tls-1.2",
    category: "https",
    label: "TLS 1.2 Support",
    status: supported ? "pass" : "fail",
    score: supported ? 10 : 0,
    maxScore: 10,
    details: supported
      ? "TLS 1.2 is supported."
      : "TLS 1.2 is not supported. This is the minimum recommended version.",
  };
}

/** Check TLS 1.3 support (bonus) */
export async function checkTLS13(domain: string): Promise<CheckResult> {
  const supported = await probeTLS(domain, "TLSv1.3");

  return {
    id: "tls-1.3",
    category: "https",
    label: "TLS 1.3 Support",
    status: supported ? "pass" : "warn",
    score: supported ? 5 : 0,
    maxScore: 5,
    details: supported
      ? "TLS 1.3 is supported (latest version, best performance)."
      : "TLS 1.3 is not supported. Consider upgrading for better security and performance.",
  };
}

/** Check TLS 1.0 absence (deprecated, should fail) */
export async function checkTLS10Absent(domain: string): Promise<CheckResult> {
  const supported = await probeTLS(domain, "TLSv1");

  return {
    id: "tls-1.0-absent",
    category: "https",
    label: "TLS 1.0 Disabled",
    status: supported ? "fail" : "pass",
    score: supported ? 0 : 5,
    maxScore: 5,
    details: supported
      ? "TLS 1.0 is still enabled. This deprecated version has known vulnerabilities."
      : "TLS 1.0 is disabled (deprecated protocol correctly rejected).",
  };
}

/** Check TLS 1.1 absence (deprecated, should fail) */
export async function checkTLS11Absent(domain: string): Promise<CheckResult> {
  const supported = await probeTLS(domain, "TLSv1.1");

  return {
    id: "tls-1.1-absent",
    category: "https",
    label: "TLS 1.1 Disabled",
    status: supported ? "fail" : "pass",
    score: supported ? 0 : 5,
    maxScore: 5,
    details: supported
      ? "TLS 1.1 is still enabled. This deprecated version should be disabled."
      : "TLS 1.1 is disabled (deprecated protocol correctly rejected).",
  };
}

/** Run all TLS version checks in parallel */
export async function checkTLSVersions(domain: string): Promise<CheckResult[]> {
  const [tls12, tls13, tls10, tls11] = await Promise.all([
    checkTLS12(domain),
    checkTLS13(domain),
    checkTLS10Absent(domain),
    checkTLS11Absent(domain),
  ]);

  return [tls12, tls13, tls10, tls11];
}

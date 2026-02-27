// Extended SSL certificate check — builds on existing checkSSL() pattern
// Extracts validFrom, validTo, protocol, cipher in addition to basic validity

import * as tls from "tls";
import type { CheckResult, SSLInfo } from "../types";

const EMPTY_SSL: SSLInfo = {
  valid: false,
  issuer: null,
  daysRemaining: null,
  validFrom: null,
  validTo: null,
  protocol: null,
  cipher: null,
};

/** Check SSL certificate with extended info */
export function checkSSLCertificate(
  domain: string,
  timeoutMs: number = 3000
): Promise<{ check: CheckResult; info: SSLInfo }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({
        check: {
          id: "ssl-certificate",
          category: "https",
          label: "SSL Certificate",
          status: "error",
          score: 0,
          maxScore: 5,
          details: "SSL certificate check timed out.",
        },
        info: EMPTY_SSL,
      });
    }, timeoutMs);

    try {
      const socket = tls.connect(
        443,
        domain,
        { servername: domain, rejectUnauthorized: false },
        () => {
          try {
            const cert = socket.getPeerCertificate();
            const protocol = socket.getProtocol() || null;
            const cipherInfo = socket.getCipher();
            const cipher = cipherInfo?.name || null;

            if (!cert || !cert.valid_to) {
              clearTimeout(timeout);
              socket.destroy();
              resolve({
                check: {
                  id: "ssl-certificate",
                  category: "https",
                  label: "SSL Certificate",
                  status: "fail",
                  score: 0,
                  maxScore: 5,
                  details: "No SSL certificate found or certificate is invalid.",
                },
                info: EMPTY_SSL,
              });
              return;
            }

            const validTo = new Date(cert.valid_to);
            const validFrom = new Date(cert.valid_from);
            const now = new Date();
            const daysRemaining = Math.floor(
              (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            const issuerParts: string[] = [];
            if (cert.issuer?.O) issuerParts.push(cert.issuer.O);
            if (cert.issuer?.CN) issuerParts.push(cert.issuer.CN);
            const issuer = issuerParts.length > 0 ? issuerParts.join(" - ") : null;

            const valid = socket.authorized && daysRemaining > 0;

            const info: SSLInfo = {
              valid,
              issuer,
              daysRemaining,
              validFrom: validFrom.toISOString(),
              validTo: validTo.toISOString(),
              protocol,
              cipher,
            };

            clearTimeout(timeout);
            socket.destroy();

            if (!valid) {
              resolve({
                check: {
                  id: "ssl-certificate",
                  category: "https",
                  label: "SSL Certificate",
                  status: "fail",
                  score: 0,
                  maxScore: 5,
                  details: daysRemaining <= 0
                    ? `SSL certificate expired ${Math.abs(daysRemaining)} days ago.`
                    : "SSL certificate is not trusted by the system.",
                },
                info,
              });
              return;
            }

            if (daysRemaining < 30) {
              resolve({
                check: {
                  id: "ssl-certificate",
                  category: "https",
                  label: "SSL Certificate",
                  status: "warn",
                  score: 3,
                  maxScore: 5,
                  details: `SSL certificate expires in ${daysRemaining} days. Renew soon.`,
                },
                info,
              });
              return;
            }

            resolve({
              check: {
                id: "ssl-certificate",
                category: "https",
                label: "SSL Certificate",
                status: "pass",
                score: 5,
                maxScore: 5,
                details: `Valid SSL certificate from ${issuer || "unknown issuer"}, expires in ${daysRemaining} days.`,
              },
              info,
            });
          } catch {
            clearTimeout(timeout);
            socket.destroy();
            resolve({
              check: {
                id: "ssl-certificate",
                category: "https",
                label: "SSL Certificate",
                status: "error",
                score: 0,
                maxScore: 5,
                details: "Error reading SSL certificate details.",
              },
              info: EMPTY_SSL,
            });
          }
        }
      );

      socket.on("error", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve({
          check: {
            id: "ssl-certificate",
            category: "https",
            label: "SSL Certificate",
            status: "fail",
            score: 0,
            maxScore: 5,
            details: "Could not establish SSL connection to the server.",
          },
          info: EMPTY_SSL,
        });
      });
    } catch {
      clearTimeout(timeout);
      resolve({
        check: {
          id: "ssl-certificate",
          category: "https",
          label: "SSL Certificate",
          status: "error",
          score: 0,
          maxScore: 5,
          details: "SSL certificate check failed.",
        },
        info: EMPTY_SSL,
      });
    }
  });
}

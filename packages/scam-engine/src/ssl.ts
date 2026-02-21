// SSL certificate check via Node.js tls module.
// Zero-cost enrichment — extracts issuer, validity, and days remaining.

import * as tls from "tls";
import { logger } from "@askarthur/utils/logger";

export interface SSLResult {
  valid: boolean;
  issuer: string | null;
  daysRemaining: number | null;
}

const EMPTY_RESULT: SSLResult = {
  valid: false,
  issuer: null,
  daysRemaining: null,
};

/**
 * Check SSL certificate for a domain.
 * 3s timeout, non-blocking — failures return empty result.
 */
export function checkSSL(domain: string): Promise<SSLResult> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve(EMPTY_RESULT);
    }, 3000);

    try {
      const socket = tls.connect(
        443,
        domain,
        { servername: domain, rejectUnauthorized: false },
        () => {
          try {
            const cert = socket.getPeerCertificate();
            if (!cert || !cert.valid_to) {
              clearTimeout(timeout);
              socket.destroy();
              resolve(EMPTY_RESULT);
              return;
            }

            const validTo = new Date(cert.valid_to);
            const now = new Date();
            const daysRemaining = Math.floor(
              (validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            const issuerParts: string[] = [];
            if (cert.issuer?.O) issuerParts.push(cert.issuer.O);
            if (cert.issuer?.CN) issuerParts.push(cert.issuer.CN);
            const issuer = issuerParts.length > 0 ? issuerParts.join(" - ") : null;

            const valid = socket.authorized && daysRemaining > 0;

            clearTimeout(timeout);
            socket.destroy();
            resolve({ valid, issuer, daysRemaining });
          } catch {
            clearTimeout(timeout);
            socket.destroy();
            resolve(EMPTY_RESULT);
          }
        }
      );

      socket.on("error", () => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(EMPTY_RESULT);
      });
    } catch (err) {
      clearTimeout(timeout);
      logger.error("SSL check error", { error: String(err), domain });
      resolve(EMPTY_RESULT);
    }
  });
}

import type { ExtensionRiskFactor } from "@askarthur/types";
import type { CRXManifest } from "./crx-parser";

export function analyzeManifest(manifest: CRXManifest): ExtensionRiskFactor[] {
  const factors: ExtensionRiskFactor[] = [];

  // 1. Content scripts with broad matches
  if (manifest.content_scripts) {
    for (const cs of manifest.content_scripts) {
      const hasBroadMatch = cs.matches.some(
        (m) => m === "<all_urls>" || m === "*://*/*" || m === "http://*/*" || m === "https://*/*"
      );
      if (hasBroadMatch) {
        factors.push({
          id: "CS_BROAD_MATCH",
          label: "Content scripts on all pages",
          severity: "HIGH",
          description:
            "This extension injects scripts into every web page you visit, which could read or modify page content.",
        });
        break;
      }
    }

    // Many content scripts
    const totalScripts = manifest.content_scripts.reduce(
      (sum, cs) => sum + (cs.js?.length ?? 0),
      0
    );
    if (totalScripts > 5) {
      factors.push({
        id: "CS_MANY_SCRIPTS",
        label: `${totalScripts} content scripts injected`,
        severity: "MEDIUM",
        description:
          "A large number of injected scripts increases the potential attack surface.",
      });
    }
  }

  // 2. CSP relaxations
  const csp = typeof manifest.content_security_policy === "string"
    ? manifest.content_security_policy
    : manifest.content_security_policy?.extension_pages ?? "";

  if (csp.includes("unsafe-eval")) {
    factors.push({
      id: "CSP_UNSAFE_EVAL",
      label: "CSP allows unsafe-eval",
      severity: "HIGH",
      description:
        "The extension's Content Security Policy allows eval(), which can execute arbitrary code.",
    });
  }

  if (csp.includes("unsafe-inline")) {
    factors.push({
      id: "CSP_UNSAFE_INLINE",
      label: "CSP allows unsafe-inline",
      severity: "MEDIUM",
      description:
        "The extension's Content Security Policy allows inline scripts, which weakens XSS protections.",
    });
  }

  // 3. Web accessible resources (large exposure)
  if (manifest.web_accessible_resources) {
    const resources = manifest.web_accessible_resources;
    let resourceCount = 0;

    for (const entry of resources) {
      if (typeof entry === "string") {
        resourceCount++;
      } else {
        resourceCount += entry.resources.length;
        // Check for broad matches
        const broadMatch = entry.matches.some(
          (m) => m === "<all_urls>" || m === "*://*/*"
        );
        if (broadMatch && entry.resources.length > 3) {
          factors.push({
            id: "WAR_BROAD_EXPOSURE",
            label: "Resources exposed to all websites",
            severity: "MEDIUM",
            description: `${entry.resources.length} extension resources are accessible from any website, which could be used for fingerprinting.`,
          });
        }
      }
    }

    if (resourceCount > 10) {
      factors.push({
        id: "WAR_MANY_RESOURCES",
        label: `${resourceCount} web-accessible resources`,
        severity: "LOW",
        description:
          "A large number of web-accessible resources increases the extension's fingerprint surface.",
      });
    }
  }

  // 4. Externally connectable — overly permissive
  if (manifest.externally_connectable) {
    const ec = manifest.externally_connectable;

    if (ec.matches) {
      const broadMatch = ec.matches.some(
        (m) => m === "<all_urls>" || m === "*://*/*" || m === "*://*.com/*"
      );
      if (broadMatch) {
        factors.push({
          id: "EC_BROAD_MATCHES",
          label: "Accepts messages from all websites",
          severity: "HIGH",
          description:
            "Any website can send messages to this extension, which could be exploited if message handlers are not carefully validated.",
        });
      }
    }

    if (ec.ids?.includes("*")) {
      factors.push({
        id: "EC_ALL_EXTENSIONS",
        label: "Accepts messages from all extensions",
        severity: "MEDIUM",
        description:
          "Any other extension can send messages to this one, which could be used for cross-extension attacks.",
      });
    }
  }

  return factors;
}

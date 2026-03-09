// Subresource Integrity (SRI) check — verify external scripts/stylesheets have integrity attributes

import * as cheerio from "cheerio";
import type { CheckResult } from "../types";

/** Check for SRI on external scripts and stylesheets */
export function checkSRI(html: string, pageUrl: string): CheckResult {
  try {
    const pageHost = new URL(pageUrl).hostname;
    const $ = cheerio.load(html);
    const missing: string[] = [];
    let totalExternal = 0;

    // Check <script src="..."> tags
    $("script[src]").each((_, el) => {
      const src = $(el).attr("src");
      if (!src) return;

      try {
        const resolved = new URL(src, pageUrl);
        if (resolved.hostname !== pageHost) {
          totalExternal++;
          if (!$(el).attr("integrity")) {
            missing.push(`script: ${src.slice(0, 80)}`);
          }
        }
      } catch {
        // Relative URL or invalid — skip
      }
    });

    // Check <link rel="stylesheet" href="..."> tags
    $('link[rel="stylesheet"][href]').each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;

      try {
        const resolved = new URL(href, pageUrl);
        if (resolved.hostname !== pageHost) {
          totalExternal++;
          if (!$(el).attr("integrity")) {
            missing.push(`stylesheet: ${href.slice(0, 80)}`);
          }
        }
      } catch {
        // Skip invalid URLs
      }
    });

    if (totalExternal === 0) {
      return {
        id: "sri",
        category: "content",
        label: "Subresource Integrity",
        status: "pass",
        score: 5,
        maxScore: 5,
        details: "No external scripts or stylesheets found — SRI not needed.",
      };
    }

    if (missing.length === 0) {
      return {
        id: "sri",
        category: "content",
        label: "Subresource Integrity",
        status: "pass",
        score: 5,
        maxScore: 5,
        details: `All ${totalExternal} external resource${totalExternal !== 1 ? "s" : ""} have SRI integrity attributes.`,
      };
    }

    const ratio = missing.length / totalExternal;

    if (ratio <= 0.5) {
      return {
        id: "sri",
        category: "content",
        label: "Subresource Integrity",
        status: "warn",
        score: 2,
        maxScore: 5,
        details: `${missing.length} of ${totalExternal} external resource${totalExternal !== 1 ? "s" : ""} missing SRI: ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ""}.`,
      };
    }

    return {
      id: "sri",
      category: "content",
      label: "Subresource Integrity",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `${missing.length} of ${totalExternal} external resource${totalExternal !== 1 ? "s" : ""} missing SRI: ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ""}.`,
    };
  } catch {
    return {
      id: "sri",
      category: "content",
      label: "Subresource Integrity",
      status: "error",
      score: 0,
      maxScore: 5,
      details: "Failed to parse HTML for SRI analysis.",
    };
  }
}

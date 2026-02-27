// Mixed content detection — parse HTML and flag http:// resources on HTTPS pages

import * as cheerio from "cheerio";
import type { CheckResult } from "../types";

// Elements and their resource attributes to check
const RESOURCE_SELECTORS: Array<{ selector: string; attr: string; label: string }> = [
  { selector: "script[src]", attr: "src", label: "script" },
  { selector: "link[href][rel=stylesheet]", attr: "href", label: "stylesheet" },
  { selector: "img[src]", attr: "src", label: "image" },
  { selector: "iframe[src]", attr: "src", label: "iframe" },
  { selector: "video[src]", attr: "src", label: "video" },
  { selector: "audio[src]", attr: "src", label: "audio" },
  { selector: "source[src]", attr: "src", label: "media source" },
  { selector: "object[data]", attr: "data", label: "object" },
  { selector: "form[action]", attr: "action", label: "form action" },
];

/** Check for mixed content (HTTP resources on HTTPS pages) */
export function checkMixedContent(html: string, pageUrl: string): CheckResult {
  try {
    const parsed = new URL(pageUrl);

    // Only relevant for HTTPS pages
    if (parsed.protocol !== "https:") {
      return {
        id: "mixed-content",
        category: "content",
        label: "Mixed Content",
        status: "skipped",
        score: 0,
        maxScore: 5,
        details: "Page is served over HTTP — mixed content check not applicable.",
      };
    }

    const $ = cheerio.load(html);
    const insecureResources: string[] = [];

    for (const { selector, attr, label } of RESOURCE_SELECTORS) {
      $(selector).each((_, el) => {
        const value = $(el).attr(attr);
        if (value && value.startsWith("http://")) {
          insecureResources.push(`${label}: ${value.slice(0, 100)}`);
        }
      });
    }

    if (insecureResources.length === 0) {
      return {
        id: "mixed-content",
        category: "content",
        label: "Mixed Content",
        status: "pass",
        score: 5,
        maxScore: 5,
        details: "No mixed content detected. All resources use HTTPS.",
      };
    }

    return {
      id: "mixed-content",
      category: "content",
      label: "Mixed Content",
      status: "fail",
      score: 0,
      maxScore: 5,
      details: `Found ${insecureResources.length} insecure resource${insecureResources.length !== 1 ? "s" : ""}: ${insecureResources.slice(0, 3).join("; ")}${insecureResources.length > 3 ? ` (+${insecureResources.length - 3} more)` : ""}.`,
    };
  } catch {
    return {
      id: "mixed-content",
      category: "content",
      label: "Mixed Content",
      status: "error",
      score: 0,
      maxScore: 5,
      details: "Failed to parse HTML for mixed content analysis.",
    };
  }
}

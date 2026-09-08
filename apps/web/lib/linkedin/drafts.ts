/** This studio is intentionally restricted to Ask Arthur's company page. */
export const ASK_ARTHUR_ORG = "urn:li:organization:114874091";
export interface LinkedInDraft {
  id: string;
  title: string;
  commentary: string;
  version: number;
  status: "draft" | "publishing" | "published" | "uncertain";
  post_urn: string | null;
  updated_at: string;
}

export function plainLinkedInText(text: string): string {
  // LinkedIn 'little' grammar: reserve no mention/formatting interpretation.
  return text.replace(/[\\|{}@\[\]()<>#*_~]/g, "\\$&");
}

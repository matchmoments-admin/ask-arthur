import { Marked, type Token, type Tokens } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import { youtubeHtml } from "@/components/blog/YouTubeEmbed";

// Register highlight.js languages
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("json", json);

// GitHub-style admonition callouts: [!TIP], [!WARNING], [!DANGER], etc.
const CALLOUT_CONFIG: Record<string, { label: string; icon: string; cls: string }> = {
  TIP: {
    label: "Tip",
    cls: "callout-tip",
    // Lucide Lightbulb icon (24×24)
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  },
  WARNING: {
    label: "Warning",
    cls: "callout-warning",
    // Lucide MessageSquareWarning icon (24×24)
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M12 15h.01"/><path d="M12 7v4"/></svg>',
  },
  DANGER: {
    label: "Danger",
    cls: "callout-danger",
    // Lucide CloudAlert icon (24×24)
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12v4"/><path d="M12 20h.01"/><path d="M8.128 16.949A7 7 0 1 1 15.71 8h1.79a1 1 0 0 1 0 9h-1.642"/></svg>',
  },
  NOTE: {
    label: "Note",
    cls: "callout-note",
    // Lucide Info icon (24×24)
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  },
  IMPORTANT: {
    label: "Important",
    cls: "callout-warning",
    // Lucide AlertCircle icon (24×24)
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
  },
};

/** Extract raw text from a token tree (for matching callout markers). */
function extractRawText(tokens: Token[]): string {
  return tokens
    .map((t) => {
      if ("text" in t && typeof t.text === "string") return t.text;
      if ("raw" in t && typeof t.raw === "string") return t.raw;
      return "";
    })
    .join("");
}

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
  {
    renderer: {
      // Auto-detect YouTube URLs in paragraphs and convert to embeds
      paragraph(token: Tokens.Paragraph) {
        const text = token.text;

        // Check if the paragraph is just a YouTube URL
        const ytMatch = text.match(
          /^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/
        );
        if (ytMatch) {
          return youtubeHtml(ytMatch[1]);
        }

        // Check for ::youtube[VIDEO_ID] syntax
        const customMatch = text.match(/^::youtube\[([\w-]+)\]$/);
        if (customMatch) {
          return youtubeHtml(customMatch[1]);
        }

        // Default paragraph rendering
        return `<p>${this.parser.parseInline(token.tokens)}</p>\n`;
      },

      // Wrap images in <figure> with optional caption from title attribute
      // Markdown: ![alt text](url "caption text")
      image({ href, title, text }: Tokens.Image) {
        const caption = title || "";
        const alt = text || "";

        if (caption) {
          return `<figure>
            <img src="${href}" alt="${alt}" loading="lazy" />
            <figcaption>${caption}</figcaption>
          </figure>`;
        }

        return `<img src="${href}" alt="${alt}" loading="lazy" />`;
      },

      // GitHub-style admonition blockquotes: > [!WARNING] content
      blockquote({ tokens }: Tokens.Blockquote) {
        const inner = this.parser.parse(tokens);

        // Check if the first text node starts with [!TYPE]
        const raw = extractRawText(tokens);
        const match = raw.match(/^\[!(\w+)\]\s*/);
        if (match) {
          const type = match[1].toUpperCase();
          const config = CALLOUT_CONFIG[type];
          if (config) {
            // Strip the [!TYPE] marker from the rendered HTML
            const cleaned = inner.replace(/\[!\w+\]\s*/, "");
            return `<div class="callout ${config.cls}"><div class="callout-title">${config.icon}<span>${config.label}</span></div><div class="callout-body">${cleaned}</div></div>\n`;
          }
        }

        return `<blockquote>${inner}</blockquote>\n`;
      },
    },
  }
);

export async function renderMarkdown(content: string): Promise<string> {
  return (await marked.parse(content)) as string;
}

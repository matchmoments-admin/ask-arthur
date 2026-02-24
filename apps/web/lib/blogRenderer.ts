import { Marked, type Tokens } from "marked";
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
    },
  }
);

export async function renderMarkdown(content: string): Promise<string> {
  return (await marked.parse(content)) as string;
}

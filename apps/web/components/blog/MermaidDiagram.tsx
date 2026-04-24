"use client";

import { useEffect } from "react";

/**
 * Hydrates `<div class="mermaid-diagram" data-mermaid-source="<b64>">`
 * sentinels emitted by `blogRenderer.ts` for ```mermaid fences.
 *
 * Mermaid is lazy-imported so non-mermaid posts don't pay the ~500KB
 * bundle cost. The source is base64-encoded to avoid HTML-escaping
 * round-trips through the sanitizer.
 */
export default function MermaidDiagram() {
  useEffect(() => {
    const sentinels = Array.from(
      document.querySelectorAll<HTMLElement>(".mermaid-diagram[data-mermaid-source]")
    );
    if (sentinels.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            background: "#FAF6EF",
            primaryColor: "#FAF6EF",
            primaryBorderColor: "#001F3F",
            primaryTextColor: "#001F3F",
            lineColor: "#001F3F",
            secondaryColor: "#F4C9B8",
            tertiaryColor: "#D9A441",
            fontFamily: "Inter, system-ui, sans-serif",
          },
        });

        for (let i = 0; i < sentinels.length; i++) {
          if (cancelled) return;
          const el = sentinels[i];
          const encoded = el.getAttribute("data-mermaid-source");
          if (!encoded) continue;
          try {
            const source = decodeBase64Utf8(encoded);
            const id = `mermaid-svg-${Date.now()}-${i}`;
            const { svg } = await mermaid.render(id, source);
            el.innerHTML = svg;
            el.removeAttribute("data-mermaid-source");
          } catch {
            // Leave the sentinel empty on render failure rather than
            // injecting a half-rendered SVG or error banner into the post.
          }
        }
      } catch {
        // Import failed — no-op. Sentinels remain visible as empty divs.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}

function decodeBase64Utf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}

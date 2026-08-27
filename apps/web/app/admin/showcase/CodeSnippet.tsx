"use client";

import type { ReactNode } from "react";

interface CodeSnippetProps {
  lang: "ts" | "tsx" | "sql" | "python" | "bash";
  title: string;
  code: string;
}

const KEYWORDS: Record<CodeSnippetProps["lang"], string[]> = {
  ts: ["const", "let", "await", "async", "function", "return", "import", "export", "new", "if", "type", "interface"],
  tsx: ["const", "let", "await", "async", "function", "return", "import", "export", "new", "if", "type", "interface"],
  sql: ["CREATE", "TABLE", "PRIMARY", "KEY", "REFERENCES", "SELECT", "INSERT", "UPDATE", "WHERE", "ON", "CONFLICT", "DO", "NOTHING", "vector", "uuid"],
  python: ["for", "in", "try", "except", "def", "return", "import", "if", "else", "with"],
  bash: ["for", "in", "do", "done", "if", "then", "fi", "export"],
};

const COMMENT_PREFIX: Record<CodeSnippetProps["lang"], string> = {
  ts: "//",
  tsx: "//",
  sql: "--",
  python: "#",
  bash: "#",
};

/**
 * Deliberately tiny highlighter: three token classes (comments, strings,
 * keywords). It exists for XSS-inertness, not bundle size — highlight.js is
 * already in this app (see lib/blogRenderer.ts), but it emits HTML strings
 * that only reach the DOM via dangerouslySetInnerHTML. This one renders every
 * token as a React text node, so no snippet can inject markup by construction.
 * A line the tokenizer can't handle renders as plain monospace text.
 */
function highlightLine(line: string, lang: CodeSnippetProps["lang"], key: number): ReactNode {
  const commentStart = line.indexOf(COMMENT_PREFIX[lang]);
  if (commentStart === 0 || (commentStart > 0 && line.slice(0, commentStart).trim() === "")) {
    return (
      <span key={key} style={{ color: "var(--color-muted)" }}>
        {line}
      </span>
    );
  }

  const parts: ReactNode[] = [];
  // Split out string literals first, then keywords in the remainder.
  const stringPattern = /("[^"]*"|'[^']*'|`[^`]*`)/g;
  const segments = line.split(stringPattern);
  segments.forEach((segment, i) => {
    if (i % 2 === 1) {
      parts.push(
        <span key={`${key}-${i}`} style={{ color: "var(--color-teal)" }}>
          {segment}
        </span>,
      );
      return;
    }
    const words = segment.split(/(\b)/);
    parts.push(
      <span key={`${key}-${i}`}>
        {words.map((word, j) =>
          KEYWORDS[lang].includes(word) ? (
            <span key={j} style={{ fontWeight: 600, color: "var(--color-ink)" }}>
              {word}
            </span>
          ) : (
            word
          ),
        )}
      </span>,
    );
  });
  return <span key={key}>{parts}</span>;
}

export default function CodeSnippet({ lang, title, code }: CodeSnippetProps) {
  const lines = code.split("\n");
  return (
    <div className="flex flex-col gap-[7px]">
      <div
        className="text-[10px] font-bold uppercase"
        style={{ letterSpacing: "0.1em", color: "var(--color-muted)" }}
      >
        Snippet — {title}
      </div>
      <pre
        className="mono m-0 overflow-x-auto"
        style={{
          background: "var(--color-surface-2)",
          border: "1px solid var(--color-line)",
          borderRadius: 10,
          padding: 12,
          fontSize: 11,
          lineHeight: 1.6,
          color: "var(--color-ink-2)",
        }}
      >
        <code>
          {lines.map((line, i) => (
            <div key={i}>{highlightLine(line, lang, i)}</div>
          ))}
        </code>
      </pre>
    </div>
  );
}

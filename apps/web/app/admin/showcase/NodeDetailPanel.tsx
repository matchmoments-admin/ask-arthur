"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import CodeSnippet from "./CodeSnippet";
import type { ShowcaseNode } from "./showcase-data";

const STATUS_LABEL: Record<NonNullable<ShowcaseNode["status"]>, string> = {
  live: "LIVE",
  dark: "DARK",
  mothballed: "MOTHBALLED",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-bold uppercase"
      style={{ letterSpacing: "0.1em", color: "var(--color-muted)" }}
    >
      {children}
    </div>
  );
}

function Bullet({ text, tone }: { text: string; tone: "teal" | "muted" }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className="mt-[6px] shrink-0"
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: tone === "teal" ? "var(--color-teal)" : "var(--color-muted-2)",
        }}
      />
      <span style={{ fontSize: 12.5, color: "var(--color-ink-2)", lineHeight: 1.5 }}>{text}</span>
    </div>
  );
}

export default function NodeDetailPanel({ node }: { node: ShowcaseNode | null }) {
  if (!node) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 text-center"
        style={{
          background: "var(--color-surface)",
          border: "1px solid var(--color-line)",
          borderRadius: 14,
          padding: "48px 24px",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div className="serif" style={{ fontSize: 17, color: "var(--color-ink)" }}>
          Select a node
        </div>
        <div style={{ fontSize: 12.5, color: "var(--color-muted)", lineHeight: 1.5 }}>
          Click any subsystem in the diagram — or Tab to it and press Enter. Esc clears the
          selection.
        </div>
      </div>
    );
  }

  return (
    <div
      aria-live="polite"
      className="flex flex-col gap-[14px]"
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-line)",
        borderRadius: 14,
        padding: 20,
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="flex items-center justify-between">
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--color-muted-2)", letterSpacing: "0.06em" }}
        >
          {node.cluster} / {node.id}
        </span>
        {node.status ? (
          <span
            className="mono font-bold"
            style={{
              fontSize: 9,
              letterSpacing: "0.08em",
              color: "var(--color-teal)",
              background: "var(--color-teal-soft)",
              borderRadius: 7,
              padding: "3px 8px",
            }}
          >
            {STATUS_LABEL[node.status]}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-[6px]">
        <div className="serif" style={{ fontSize: 22, color: "var(--color-ink)", lineHeight: 1.1 }}>
          {node.title}
        </div>
        <div style={{ fontSize: 13, color: "var(--color-muted)", lineHeight: 1.5 }}>
          {node.tagline}
        </div>
      </div>

      <div className="flex flex-col gap-[7px]">
        <SectionLabel>Features</SectionLabel>
        {node.features.map((feature) => (
          <Bullet key={feature} text={feature} tone="teal" />
        ))}
      </div>

      <div className="flex flex-col gap-[7px]">
        <SectionLabel>Tech stack</SectionLabel>
        <div className="flex flex-wrap gap-[6px]">
          {node.techStack.map((tech) => (
            <span
              key={tech}
              className="mono"
              style={{
                fontSize: 11,
                color: "var(--color-ink-2)",
                background: "var(--color-surface-2)",
                border: "1px solid var(--color-line)",
                borderRadius: 6,
                padding: "3px 8px",
              }}
            >
              {tech}
            </span>
          ))}
        </div>
      </div>

      {node.codeSnippet ? (
        <CodeSnippet
          lang={node.codeSnippet.lang}
          title={node.codeSnippet.title}
          code={node.codeSnippet.code}
        />
      ) : null}

      <div className="flex flex-col gap-[7px]">
        <SectionLabel>Engineering notes</SectionLabel>
        {node.engineeringNotes.map((note) => (
          <Bullet key={note} text={note} tone="muted" />
        ))}
      </div>

      {node.deepLink ? (
        <div className="flex items-center gap-[10px] pt-1">
          <Link
            href={node.deepLink.href}
            className="inline-flex items-center gap-[7px] font-semibold text-white"
            style={{
              background: "var(--color-teal)",
              fontSize: 12.5,
              borderRadius: 8,
              padding: "8px 14px",
            }}
          >
            {node.deepLink.label}
            <ArrowRight size={14} strokeWidth={2} aria-hidden="true" />
          </Link>
          <span className="mono" style={{ fontSize: 10, color: "var(--color-muted-2)" }}>
            #{node.id}
          </span>
        </div>
      ) : null}
    </div>
  );
}

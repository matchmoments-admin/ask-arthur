"use client";

import { useState } from "react";

export default function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing if clipboard API unavailable
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-action-teal-text transition-colors"
      aria-label="Copy link to this post"
    >
      <span className="material-symbols-outlined text-base">
        {copied ? "check" : "link"}
      </span>
      <span>{copied ? "Copied" : "Copy link"}</span>
    </button>
  );
}

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
      className="text-deep-navy font-medium hover:text-action-teal transition-colors inline-flex items-center gap-1"
    >
      <span className="material-symbols-outlined text-base">
        {copied ? "check" : "link"}
      </span>
      <span>{copied ? "Copied" : "Copy link"}</span>
    </button>
  );
}

"use client";

import { useState } from "react";
import { Check, Link } from "lucide-react";

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
      {copied ? <Check size={16} /> : <Link size={16} />}
      <span>{copied ? "Copied" : "Copy link"}</span>
    </button>
  );
}

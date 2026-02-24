"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BlogSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim()) {
      router.push(`/blog/search?q=${encodeURIComponent(query.trim())}`);
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-slate-400 hover:text-deep-navy transition-colors p-1"
        aria-label="Search blog"
      >
        <span className="material-symbols-outlined text-xl">search</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => !query && setOpen(false)}
        placeholder="Search…"
        className="w-36 text-sm border-b border-border-light bg-transparent py-1 text-deep-navy placeholder:text-slate-400 focus:border-deep-navy focus:outline-none transition-colors"
      />
    </form>
  );
}

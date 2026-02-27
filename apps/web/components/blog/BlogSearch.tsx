"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

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

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-slate-400 hover:text-deep-navy transition-colors"
        aria-label="Search blog"
      >
        <Search size={20} />
        <span className="text-sm font-medium">Search</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="relative">
      <Search className="text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" size={18} />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onBlur={() => !query && setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder="Search…"
        className="w-48 text-sm pl-8 pr-3 py-1.5 border border-border-light rounded-full bg-white text-deep-navy placeholder:text-slate-400 focus:border-deep-navy focus:outline-none transition-colors"
      />
    </form>
  );
}

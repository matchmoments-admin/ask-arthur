"use client";

import { useMemo, useState } from "react";

// Interactive "Today's sweep" grid for the clone-watch pillar page. The server
// component fetches the operator-CONFIRMED alerts (RLS-gated, service-role) and
// hands us a lean, already-safe array; all the search / filter / group-by-brand
// interactivity lives here because a server component can't hold client state.
//
// Safety: `typeKey` is pre-mapped server-side through a fixed whitelist, so no
// attacker-influenced signal token reaches the badge. Domains render as text
// (React-escaped). Rows are already tp_confirmed/tp_actioned before they arrive.

export type CloneDomainItem = {
  domain: string;
  brand: string | null;
  typeKey: "t" | "b" | "l" | "match";
  firstSeenAt: string;
};

const MONO = "var(--font-plex-mono), ui-monospace, monospace";

// Badge palette per signal type — restrained, mapped to conventional Tailwind
// hues (typo=amber, brand-in-domain=blue, look-alike=violet, fallback=slate).
const META: Record<
  CloneDomainItem["typeKey"],
  { label: string; dot: string; bg: string; fg: string }
> = {
  t: { label: "1-char typo", dot: "#d97706", bg: "#fbf1dd", fg: "#8a5a12" },
  b: { label: "Brand in domain", dot: "#3a6ea8", bg: "#e7eff8", fg: "#2b527d" },
  l: { label: "Look-alike chars", dot: "#8257c4", bg: "#efe9fb", fg: "#5b3aa0" },
  match: { label: "Pattern match", dot: "#94a3b8", bg: "#f1f3f7", fg: "#475569" },
};

// Filter pills shown (All + the three canonical signal types).
const FILTER_KEYS: Array<"all" | "t" | "b" | "l"> = ["all", "t", "b", "l"];

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function CloneWatchDomainList({
  items,
}: {
  items: CloneDomainItem[];
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "t" | "b" | "l">("all");
  const [groupByBrand, setGroupByBrand] = useState(false);

  const counts = useMemo(() => {
    const c = { all: items.length, t: 0, b: 0, l: 0 } as Record<string, number>;
    for (const it of items) if (it.typeKey in c) c[it.typeKey]++;
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(
      (it) =>
        (filter === "all" || it.typeKey === filter) &&
        (!q ||
          it.domain.toLowerCase().includes(q) ||
          (it.brand ?? "").toLowerCase().includes(q)),
    );
  }, [items, query, filter]);

  const groups = useMemo(() => {
    if (!groupByBrand) {
      return [{ brand: "", countLabel: "", items: filtered }];
    }
    const map = new Map<string, CloneDomainItem[]>();
    for (const it of filtered) {
      const key = it.brand ?? "—";
      const arr = map.get(key) ?? [];
      arr.push(it);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .map(([brand, list]) => ({
        brand,
        countLabel: `${list.length} ${list.length === 1 ? "domain" : "domains"}`,
        items: list,
      }))
      .sort((a, b) => b.items.length - a.items.length || a.brand.localeCompare(b.brand));
  }, [filtered, groupByBrand]);

  const resultCount = `${filtered.length} ${filtered.length === 1 ? "domain" : "domains"}`;

  return (
    <section className="mt-14" aria-labelledby="sweep-heading">
      {/* Header + search */}
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <h2
            id="sweep-heading"
            className="text-2xl md:text-[26px] font-extrabold tracking-tight text-deep-navy"
          >
            Today&apos;s sweep
          </h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Showing <strong className="font-bold text-gov-slate">{resultCount}</strong> · newest first
          </p>
        </div>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </span>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search domain or brand…"
            aria-label="Search domain or brand"
            className="w-[280px] max-w-[60vw] rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-deep-navy outline-none focus:border-deep-navy"
          />
        </div>
      </div>

      {/* Filter pills + group toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex flex-wrap gap-2.5">
          {FILTER_KEYS.map((key) => {
            const active = filter === key;
            const label = key === "all" ? "All" : META[key].label;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(key)}
                className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
                  active
                    ? "border-deep-navy bg-deep-navy text-white"
                    : "border-slate-200 bg-white text-gov-slate hover:border-slate-300"
                }`}
              >
                {label}
                <span className={active ? "text-white/65" : "text-slate-400"}>{counts[key]}</span>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          aria-pressed={groupByBrand}
          onClick={() => setGroupByBrand((g) => !g)}
          className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${
            groupByBrand
              ? "border-deep-navy bg-deep-navy text-white"
              : "border-slate-200 bg-white text-gov-slate hover:border-slate-300"
          }`}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 6h16M4 12h10M4 18h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
          </svg>
          Group by brand
        </button>
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-lg font-semibold text-deep-navy mb-2">
            {items.length === 0
              ? "No registrations matched in the last 7 days"
              : "No domains match your search"}
          </p>
          <p className="text-sm text-gov-slate">
            {items.length === 0
              ? "New entries appear here within hours of each daily sweep (08:30 UTC)."
              : "Try a different brand name or clear the filter."}
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.brand || "__all"} className="mb-3.5">
            {groupByBrand && (
              <div className="flex items-center gap-3.5 mt-6 mb-3.5">
                <span className="text-[15px] font-semibold text-deep-navy" style={{ fontFamily: MONO }}>
                  {g.brand}
                </span>
                <span className="text-xs font-medium text-slate-500">{g.countLabel}</span>
                <span className="flex-1 h-px bg-slate-200" />
              </div>
            )}
            <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {g.items.map((d, i) => {
                const m = META[d.typeKey];
                return (
                  <article
                    key={`${d.domain}-${i}`}
                    className="flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-white p-4 transition-shadow hover:border-slate-300 hover:shadow-[0_10px_26px_-18px_rgba(15,39,68,0.35)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold"
                        style={{ background: m.bg, color: m.fg }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.dot }} />
                        {m.label}
                      </span>
                      {/* ISR-cached SSR value can lag the client's clock by up
                          to the revalidate window; let the client value win
                          without a hydration warning (cosmetic relative time). */}
                      <span
                        className="whitespace-nowrap text-xs font-medium text-slate-400"
                        suppressHydrationWarning
                      >
                        {relativeAge(d.firstSeenAt)}
                      </span>
                    </div>
                    <div
                      className="break-all text-[15px] font-semibold leading-snug text-deep-navy"
                      style={{ fontFamily: MONO }}
                    >
                      {d.domain}
                    </div>
                    {d.brand && (
                      <div className="flex items-center gap-2 text-[13px] text-slate-500">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0">
                          <path
                            d="M9 7 4 12l5 5M4 12h11a5 5 0 0 0 5-5V6"
                            stroke="#b3bdc9"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                        <span>resembles</span>
                        <span className="break-all font-medium text-gov-slate" style={{ fontFamily: MONO }}>
                          {d.brand}
                        </span>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

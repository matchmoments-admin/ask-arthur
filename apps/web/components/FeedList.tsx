"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, Loader2 } from "lucide-react";
import FeedCard from "./FeedCard";
import Pill from "./Pill";
import { CATEGORY_CONFIG, COUNTRY_OPTIONS, SOURCE_CONFIG } from "@/lib/feed";
import type { FeedItem } from "@/lib/feed";

type FeedListProps = {
  initialItems: FeedItem[];
  initialTotal: number;
};

const SOURCE_FILTERS = [
  { value: "", label: "All" },
  { value: "reddit", label: "Reddit" },
  { value: "user_report", label: "Reported" },
  { value: "verified_scam", label: "Verified" },
];

export default function FeedList({ initialItems, initialTotal }: FeedListProps) {
  const searchParams = useSearchParams();
  const initialSource = searchParams.get("source") ?? "";
  const initialCategory = searchParams.get("category") ?? "";
  const initialCountry = (searchParams.get("country") ?? "").toUpperCase();
  const initialSearch = searchParams.get("search") ?? "";
  const hasUrlFilter = Boolean(
    initialSource || initialCategory || initialCountry || initialSearch
  );

  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Filters — seeded from URL on mount so deep-links auto-apply
  const [source, setSource] = useState(initialSource);
  const [category, setCategory] = useState(initialCategory);
  const [country, setCountry] = useState(initialCountry);
  const [search, setSearch] = useState(initialSearch);
  const [showFilters, setShowFilters] = useState(
    Boolean(initialCategory || initialCountry)
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFeed = useCallback(
    async (params: {
      page: number;
      source: string;
      category: string;
      country: string;
      search: string;
      append?: boolean;
    }) => {
      const isAppend = params.append ?? false;
      if (isAppend) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const qs = new URLSearchParams();
      qs.set("page", String(params.page));
      qs.set("limit", "20");
      if (params.source) qs.set("source", params.source);
      if (params.category) qs.set("category", params.category);
      if (params.country) qs.set("country", params.country);
      if (params.search) qs.set("search", params.search);

      try {
        const res = await fetch(`/api/feed?${qs.toString()}`);
        const data = await res.json();

        if (isAppend) {
          setItems((prev) => [...prev, ...(data.items || [])]);
        } else {
          setItems(data.items || []);
        }
        setTotal(data.total || 0);
        setPage(params.page);
      } catch {
        // Silently handle fetch errors
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    []
  );

  // Re-fetch when filters change (not search — that's debounced)
  const applyFilters = useCallback(
    (newSource: string, newCategory: string, newCountry: string, newSearch: string) => {
      fetchFeed({
        page: 1,
        source: newSource,
        category: newCategory,
        country: newCountry,
        search: newSearch,
      });
    },
    [fetchFeed]
  );

  const handleSourceChange = (val: string) => {
    setSource(val);
    applyFilters(val, category, country, search);
  };

  const handleCategoryChange = (val: string) => {
    setCategory(val);
    applyFilters(source, val, country, search);
  };

  const handleCountryChange = (val: string) => {
    setCountry(val);
    applyFilters(source, category, val, search);
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      applyFilters(source, category, country, val);
    }, 500);
  };

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Apply URL-derived filters on mount (server only sends unfiltered initial items)
  useEffect(() => {
    if (hasUrlFilter) {
      fetchFeed({
        page: 1,
        source: initialSource,
        category: initialCategory,
        country: initialCountry,
        search: initialSearch,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMore = () => {
    fetchFeed({
      page: page + 1,
      source,
      category,
      country,
      search,
      append: true,
    });
  };

  const hasMore = items.length < total;

  return (
    <div>
      {/* Search + filter toggle */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search scam reports..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-border-light rounded-lg text-sm focus:ring-2 focus:ring-action-teal focus:border-action-teal"
          />
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 px-4 py-2.5 border rounded-lg text-sm font-medium transition-colors ${
            showFilters
              ? "border-action-teal text-action-teal bg-action-teal/5"
              : "border-border-light text-gov-slate hover:border-slate-300"
          }`}
        >
          <SlidersHorizontal size={14} />
          Filters
        </button>
      </div>

      {/* Source filter chips */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {SOURCE_FILTERS.map((f) => (
          <Pill
            key={f.value}
            label={f.label}
            active={source === f.value}
            onClick={() => handleSourceChange(f.value)}
          />
        ))}
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="flex gap-3 mb-6 flex-wrap">
          <select
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value)}
            className="px-3 py-2 border border-border-light rounded-lg text-sm text-gov-slate"
          >
            <option value="">All Categories</option>
            {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
              <option key={key} value={key}>
                {cfg.label}
              </option>
            ))}
          </select>
          <select
            value={country}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="px-3 py-2 border border-border-light rounded-lg text-sm text-gov-slate"
          >
            {COUNTRY_OPTIONS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Results count */}
      <p className="text-xs text-slate-400 mb-4">
        {total.toLocaleString()} result{total !== 1 ? "s" : ""}
      </p>

      {/* Loading state */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin text-action-teal" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <p className="text-lg font-semibold text-deep-navy mb-2">
            No scam reports found
          </p>
          <p className="text-sm text-gov-slate">
            Try adjusting your filters or search terms.
          </p>
        </div>
      ) : (
        <>
          {/* Feed grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {items.map((item) => (
              <FeedCard key={item.id} item={item} />
            ))}
          </div>

          {/* Load more */}
          {hasMore && (
            <div className="flex justify-center mt-8">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 bg-deep-navy text-white font-medium text-sm rounded-lg hover:bg-deep-navy/90 transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <span className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Loading...
                  </span>
                ) : (
                  "Load more"
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

import Link from "next/link";

interface PaginationProps {
  page: number;
  totalPages: number;
  basePath: string;
  /** Additional query params to preserve (e.g. category) */
  extraParams?: Record<string, string>;
}

export default function Pagination({
  page,
  totalPages,
  basePath,
  extraParams,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  function buildHref(p: number): string {
    const params = new URLSearchParams(extraParams);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <nav
      className="flex items-center justify-between mt-10 pt-6 border-t border-border-light"
      aria-label="Blog pagination"
    >
      {page > 1 ? (
        <Link
          href={buildHref(page - 1)}
          className="text-sm text-action-teal-text font-medium hover:underline"
        >
          &larr; Previous
        </Link>
      ) : (
        <span />
      )}

      <span className="text-xs text-slate-400">
        Page {page} of {totalPages}
      </span>

      {page < totalPages ? (
        <Link
          href={buildHref(page + 1)}
          className="text-sm text-action-teal-text font-medium hover:underline"
        >
          Next &rarr;
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

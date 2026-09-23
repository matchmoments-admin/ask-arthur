/**
 * The ONE statement of clone-watch's sourcing limit, on every surface that
 * shows brand counts (index, method, monthly edition; the share page and the
 * brand email carry the same sentence in their own layout). Review 2026-09-23:
 * the `.au` gap was disclosed on one surface only, so a bank reading
 * "Westpac: 3" took a generic-TLD count as its full exposure (#772).
 */
export const CLONE_WATCH_COVERAGE_SENTENCE =
  "Coverage is newly registered generic-TLD domains (.com, .shop, .xyz and similar). .au registrations are not yet included, so counts for brands on .au domains are a lower bound.";

export default function CoverageNote({ className = "" }: { className?: string }) {
  return (
    <p className={`text-xs leading-relaxed text-slate-500 ${className}`}>
      <strong className="font-semibold text-slate-600">Coverage:</strong>{" "}
      {CLONE_WATCH_COVERAGE_SENTENCE.replace(/^Coverage is /, "")}
    </p>
  );
}

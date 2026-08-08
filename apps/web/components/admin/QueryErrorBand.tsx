// Shared "these zeros are not measurements" band for admin pages (#945).
//
// The console's most systemic defect: every admin page coalesced a failed
// query into `?? []` / `?? 0`, so a broken query rendered identically to a
// healthy-empty result — an operator reading "0 pending" during an outage
// concludes all is well. PR #929 fixed exactly this for one feed panel; the
// pattern survived on 12 more pages, which is what this component retires.
//
// Renders nothing when there are no errors, so it is safe to place
// unconditionally at the top of any admin page.
export default function QueryErrorBand({ errors }: { errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <div
      role="alert"
      className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <strong>Some data failed to load</strong> — any zeros or empty tables below
      are NOT measurements: {errors.join(", ")}. Reload; if it persists, check the
      service role and Supabase status before acting on this page.
    </div>
  );
}

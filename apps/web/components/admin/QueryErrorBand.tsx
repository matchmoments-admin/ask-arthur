// Shared "these zeros are not measurements" band for admin pages (#945).
//
// The console's most systemic defect: every admin page coalesced a failed
// query into `?? []` / `?? 0`, so a broken query rendered identically to a
// healthy-empty result — an operator reading "0 pending" during an outage
// concludes all is well. PR #929 fixed exactly this for one feed panel.
//
// The sweep is COMPLETE as of #945: every admin page that builds a service
// client either renders this band or is an allowlisted exception with a written
// reason. Don't re-list the pages here — that list drifted the moment it was
// written. `__tests__/adminErrorBand.test.ts` enforces it, and its ALLOWLIST is
// the one place the exceptions live.
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

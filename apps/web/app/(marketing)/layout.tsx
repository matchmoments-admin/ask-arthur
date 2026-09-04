import Footer from "@/components/Footer";
import Nav from "@/components/Nav";

/**
 * The shell every public marketing page needs.
 *
 * This exists because the convention had no enforcer. The `(marketing)` group
 * had no layout, so each page hand-rendered `Nav`, `Footer`, the flex column
 * and `id="main-content"` — and two of the three got it wrong:
 *
 *   - `scam-feed/[id]` shipped with NO navigation and no footer at all, and no
 *     skip-link target, so the root layout's accessibility skip link pointed
 *     at nothing on that route.
 *   - `spf-compliance` shipped with no navigation either, plus `max-w-4xl px-4
 *     py-16` against the documented `px-5 pt-16 pb-16`.
 *
 * Neither was visible in isolation. Both pages looked fine on their own; they
 * were only wrong against the documented shell. That is the definition of a
 * convention that wants to be a module.
 *
 * WHAT THIS OWNS: the invariant part — the flex column, Nav, Footer, the skip
 * target, and the vertical/horizontal padding. A page can no longer omit them.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN: the container WIDTH. DESIGN_SYSTEM.md
 * sets `max-w-[640px]` as the default but keeps a documented exceptions table
 * — `/scam-map` runs at `max-w-3xl`. Forcing one width here would either break
 * that page or push it into a workaround. So each page sets `max-w-*` on its
 * own root element, where it sits next to the page's own code and can be read
 * against the exceptions table.
 *
 * Mirrors `app/intel/layout.tsx` and `app/blog/layout.tsx`, which already do
 * this for their own route groups.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main-content" className="flex-1 w-full px-5 pt-16 pb-16">
        {children}
      </main>
      <Footer />
    </div>
  );
}

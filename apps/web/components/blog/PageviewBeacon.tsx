"use client";

import { useEffect } from "react";
import { track } from "@/lib/track";

// Fires a single first-party `pageview` event on mount so blog posts feed the
// owned analytics store (v190) that backs the on-page view count. The rest of
// the site does not emit pageview yet — this is the first caller — so it is
// scoped to the blog post page rather than the root layout.
//
// Fire-and-forget: `track()` no-ops on the server, never throws, and the write
// path itself no-ops without the aa_attribution cookie. StrictMode double-
// invokes effects in dev; that inflation is dev-only and irrelevant to prod.
//
// PATH CONTRACT: track() stores `window.location.pathname`, which on this page
// is `blogPostPath(slug)` (= `/blog/<slug>`). getPostViewCount() reads back
// with that exact string. Keep the two in lockstep — see lib/blogPath.ts.
export default function PageviewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    track("pageview", { content_type: "blog_post", slug });
  }, [slug]);

  return null;
}

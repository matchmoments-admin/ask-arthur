// Single source of truth for a blog post's URL path.
//
// This is the join key between the WRITE side (PageviewBeacon → track("pageview")
// stores window.location.pathname) and the READ side (getPostViewCount filters
// analytics_events on this exact string). If the two ever diverge, the view
// count silently returns 0 with no error — so the path shape lives here, once.
//
// Pure + dependency-free on purpose: imported by both a client component
// (PageviewBeacon) and server code (lib/blog.ts), so it must not pull in any
// server-only module.
export function blogPostPath(slug: string): string {
  return `/blog/${slug}`;
}

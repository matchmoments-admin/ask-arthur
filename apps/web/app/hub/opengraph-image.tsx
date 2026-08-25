// LinkedIn / social card for /hub.
//
// Route-colocated, so Next emits the absolute og:image + twitter:image tags
// itself — no manual meta needed in page.tsx. This is the first og:image in
// the app; the root layout declares openGraph with no image at all, so every
// other shared link still renders a bare card.
//
// DELIBERATELY STATIC. It would be easy to pull the live clone-watch numbers
// in here, but LinkedIn caches a preview for roughly a week and only re-scrapes
// via the post-inspector — so a "live" card would show a frozen number while
// claiming freshness, which is worse than not printing one. The numbers live
// on the page, where they refresh hourly.
//
// No custom font is loaded: ImageResponse falls back to its built-in sans,
// matching app/api/og/scan/route.tsx. A font fetch here would put a network
// dependency in front of every social scrape.

import { ImageResponse } from "next/og";

export const alt = "Ask Arthur — free AI scam checker for Australia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0B0B0C";
const CREAM = "#F3F0E9";
const MUTED = "#9A968D";
const ACCENT = "#E5B94E";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: INK,
          padding: "64px 72px",
        }}
      >
        {/* Wordmark + rule */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 34, height: 4, background: ACCENT }} />
          <div
            style={{
              color: CREAM,
              fontSize: 28,
              fontWeight: 700,
              letterSpacing: "-0.01em",
            }}
          >
            Ask Arthur
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              color: CREAM,
              fontSize: 96,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: "-0.04em",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div>Suspicious message?</div>
            <div>Just ask.</div>
          </div>
          <div
            style={{
              color: MUTED,
              fontSize: 30,
              marginTop: 26,
              letterSpacing: "-0.01em",
            }}
          >
            A free AI scam checker for Australia.
          </div>
        </div>

        {/* Footer strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: `1px solid rgba(243,240,233,0.14)`,
            paddingTop: 26,
          }}
        >
          <div style={{ color: ACCENT, fontSize: 24, letterSpacing: "0.14em" }}>
            NO SIGNUP · NOTHING STORED
          </div>
          <div style={{ color: MUTED, fontSize: 24 }}>askarthur.au</div>
        </div>
      </div>
    ),
    size,
  );
}

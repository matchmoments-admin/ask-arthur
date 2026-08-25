/**
 * Sitewide OG card export — renders public/og-default.png (1200x630).
 *
 * WHY A SCRIPT AND NOT app/opengraph-image.tsx:
 * The sitewide card is a fixed brand asset — same for every route — so there is
 * nothing to compute per request. Rendering it in the browser via Puppeteer
 * (rather than Satori/ImageResponse) buys two things that matter here:
 *
 *   1. Real Public Sans. ImageResponse needs font BINARIES supplied to it; it
 *      cannot see next/font. Without vendoring a .ttf into the repo the card
 *      falls back to a generic sans, which is exactly the wrong look for the
 *      one image representing the brand everywhere. A browser just loads the
 *      webfont.
 *   2. Zero runtime cost. A static PNG is served by the CDN; ImageResponse
 *      would re-render on every social scrape.
 *
 * Route-level cards still win where they exist: app/hub/opengraph-image.tsx
 * overrides this one for /hub, because the Next file convention beats parent
 * metadata. This is the FALLBACK for everything else.
 *
 * Network is used at generation time only (Google Fonts), never at runtime.
 *
 *   pnpm --filter @askarthur/web og:card
 *
 * Options:
 *   --out=PATH   output file (default: public/og-default.png)
 *
 * Re-run after editing HEADLINE/SUB/FOOTER below, and commit the PNG.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import sharp from "sharp";

const WIDTH = 1200;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");

// 1200x630 is the Open Graph standard and what LinkedIn, Slack and X all crop
// against. (LinkedIn's older 1200x627 guidance renders identically.)
const HEIGHT = 630;

/* ---- Copy. Keep in lockstep with the root openGraph metadata in
        app/layout.tsx so the card and the text card say the same thing. ---- */
const WORDMARK = "ASK ARTHUR";
const HEADLINE = ["Suspicious message?", "Just ask."];
const SUB = "Free AI scam checker for Australia. Paste a message, link or screenshot — verdict in seconds.";
const DOMAIN = "askarthur.au";
const TRUST = "No signup · Nothing stored";

/* ---- Brand tokens (DESIGN_SYSTEM.md + the illustration's own palette) ----
   The ground is the illustration's cream, NOT the site's white: the artwork
   carries a cream field, so a white card would show it as a visible rectangle.

   CREAM below is only the pre-paint value. The real ground is SAMPLED from the
   artwork's own corner pixel at render time (see sampleGround in main) — the
   generated illustration came back at #F9F3E7 rather than the #FAF6EF the
   prompt asked for, an 8-point gap in blue that showed as a clear vertical
   band down the middle of the card. Sampling makes that class of seam
   impossible rather than merely fixed-once. */
const CREAM = "#FAF6EF";
const NAVY = "#001F3F";
const SLATE = "#42526E";
const OCHRE = "#D9A441";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

function buildHtml(illoDataUri: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden}
  body{
    background:${CREAM};
    font-family:'Public Sans',system-ui,sans-serif;
    -webkit-font-smoothing:antialiased;
    display:flex;
  }
  .copy{
    flex:0 0 60%;
    padding:56px 0 52px 64px;
    display:flex;flex-direction:column;justify-content:space-between;
  }
  .wordmark{display:flex;align-items:center;gap:14px}
  .rule{width:30px;height:4px;background:${NAVY};border-radius:2px}
  .wordmark span{
    font-size:20px;font-weight:700;color:${NAVY};
    letter-spacing:.16em;
  }
  h1{
    /* 54px, not 62: at 62 the longest line ("Suspicious message?") overran the
       copy column and was clipped by the artwork. */
    font-size:54px;font-weight:800;line-height:1.06;
    letter-spacing:-.035em;color:${NAVY};
    white-space:nowrap;
  }
  .sub{
    font-size:22px;font-weight:400;line-height:1.45;color:${SLATE};
    max-width:30ch;margin-top:18px;
  }
  .foot{
    display:flex;align-items:center;gap:16px;
    padding-top:22px;border-top:1px solid rgba(0,31,63,.14);
    /* keep the rule clear of the artwork column */
    margin-right:24px;
  }
  .domain{font-size:22px;font-weight:700;color:${NAVY};letter-spacing:-.01em}
  .dot{width:6px;height:6px;border-radius:50%;background:${OCHRE}}
  .trust{font-size:19px;font-weight:500;color:${SLATE}}
  .art{
    flex:1;position:relative;
  }
  /* Bottom-aligned so the figure's ground line meets the card's base — the
     artwork reads as standing on the card rather than floating in it.
     Sized by WIDTH (not height): at height:100% the portrait artwork computed
     wider than its column and spilled left over the headline. */
  .art img{
    position:absolute;right:24px;bottom:0;
    width:100%;height:auto;max-height:100%;
  }
</style></head>
<body>
  <div class="copy">
    <div class="wordmark"><span class="rule"></span><span>${WORDMARK}</span></div>
    <div>
      <h1>${HEADLINE.map((l) => `<div>${l}</div>`).join("")}</h1>
      <p class="sub">${SUB}</p>
    </div>
    <div class="foot">
      <span class="domain">${DOMAIN}</span>
      <span class="dot"></span>
      <span class="trust">${TRUST}</span>
    </div>
  </div>
  <div class="art"><img src="${illoDataUri}" alt=""></div>
</body></html>`;
}

async function main() {
  const illoPath = path.join(WEB_ROOT, "public", "og", "arthur-pause.jpg");
  const illo = await fs.readFile(illoPath).catch(() => {
    throw new Error(`illustration not found at ${illoPath}`);
  });
  const dataUri = `data:image/jpeg;base64,${illo.toString("base64")}`;
  const out = path.resolve(arg("out") ?? path.join(WEB_ROOT, "public", "og-default.png"));

  let shot: Uint8Array;
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    // deviceScaleFactor 2 then downsample: renders the type at 2x and lets the
    // resampler do the antialiasing, which is visibly cleaner at 1200px than
    // rasterising directly at 1x.
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    // networkidle0 is safe here (unlike the app-page exporters): this is a
    // static setContent with exactly one external request, the webfont.
    await page.setContent(buildHtml(dataUri), { waitUntil: "networkidle0", timeout: 60_000 });

    // Assert the webfont actually loaded. Silently falling back to a system
    // sans would produce a card that looks fine in isolation and wrong beside
    // every other brand surface — the failure mode worth failing loudly on.
    // Repaint the card ground in the artwork's OWN corner colour, so the
    // artwork's cream field and the card's cream are the same value by
    // construction and no vertical band can appear between them. Done in-page
    // via canvas — no image-decoding dependency in Node.
    const ground = await page.evaluate(async () => {
      const img = document.querySelector("img");
      if (!img) return null;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      // Top-left 8x8 of the artwork is always background field.
      ctx.drawImage(img, 0, 0, 8, 8, 0, 0, 8, 8);
      const [r, g, b] = ctx.getImageData(1, 1, 1, 1).data;
      const rgb = `rgb(${r}, ${g}, ${b})`;
      document.body.style.background = rgb;
      return rgb;
    });
    if (!ground) throw new Error("could not sample the artwork's ground colour");
    console.log(`  ground sampled from artwork: ${ground}`);

    const gotFont = await page.evaluate(async () => {
      await (document as unknown as { fonts: FontFaceSet }).fonts.ready;
      return (document as unknown as { fonts: FontFaceSet }).fonts.check("800 62px 'Public Sans'");
    });
    if (!gotFont) {
      throw new Error(
        "Public Sans did not load — refusing to ship a card in a fallback font. Check network access to fonts.googleapis.com.",
      );
    }

    shot = await page.screenshot({
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
    });
  } finally {
    await browser.close();
  }

  // Downsample the 2x capture to exactly 1200x630 and compress LOSSLESSLY.
  //
  // Size: the default 2x-downsampled png is ~403 KB, which made this the
  // third-largest file in public/ — bigger than every existing illustration.
  // The bulk is the artwork's halftone grain, not the type. `effort: 10` +
  // max zlib takes it to ~151 KB (-63%) with every pixel bit-identical.
  //
  // DELIBERATELY NOT `palette: true`. A 128-entry palette is far smaller
  // (~48 KB) and its effect on the type is invisible — but it wrecks a brand
  // colour: the lone ochre accent dot (#D9A441) has too little pixel area to
  // earn its own palette slot and gets merged into the illustration's
  // neighbouring terracotta, landing at rgb(198,114,78) — a 50-point drop in
  // green, mustard to rust. Raising `colours` to 192/256 fixes the hue but
  // returns the file to ~155 KB, i.e. no better than lossless while now being
  // lossy. Lossless is the correct trade here.
  //
  // sharp rather than `sips`: same result on every platform, and it keeps this
  // script runnable off macOS.
  await sharp(shot)
    .resize(WIDTH, HEIGHT)
    .png({ effort: 10, compressionLevel: 9 })
    .toFile(out);

  const { size } = await fs.stat(out);
  console.log(`✓ OG card → ${out} (${Math.round(size / 1024)} KB, ${WIDTH}x${HEIGHT})`);
  if (size > 5 * 1024 * 1024) {
    throw new Error("card exceeds 5 MB — LinkedIn will not render it");
  }
}

main().catch((err) => {
  console.error("og card export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

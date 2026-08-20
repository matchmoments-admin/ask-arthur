/**
 * Hub carousel export — turns /hub into a LinkedIn document (carousel).
 *
 * Screenshots each chapter of /hub (via ?slide=N) at 1080×1350 and assembles
 * them into an upload-ready PDF (+ individual PNGs). Reuses the Puppeteer
 * already in the workspace — no new dependency, no Inngest, no cron. You run
 * it by hand:
 *
 *   # 1. have the web app running (dev or a preview URL)
 *   pnpm --filter @askarthur/web dev
 *   # 2. in another shell:
 *   pnpm --filter @askarthur/web hub:carousel
 *
 * Options (flags or env):
 *   --base=URL          app base URL (default: http://localhost:3000)
 *   --out=DIR           output dir (default: ./hub-carousel-out)
 *
 * Unlike scripts/clone-watch-report-export.ts (which this is cloned from),
 * /hub is public — there is no ADMIN_SECRET and no admin cookie to mint.
 *
 * The capture guards below are inherited deliberately; see captureSlide().
 */
import "./_load-env-config";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

// Keep in sync with the CHAPTERS array in app/hub/page.tsx.
const SLIDE_COUNT = 5;
const WIDTH = 1080;
const HEIGHT = 1350;

/**
 * Coarse "this is not a slide" floor. The hub is a dark, largely flat surface,
 * so its PNGs compress far harder than the report-card's — this floor is set
 * low on purpose and only catches an essentially empty frame. The relative
 * median check in main() is the real blank guard; do not raise this without
 * measuring a real run first.
 */
const BLANK_PNG_BYTES = 15_000;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

/**
 * Navigate to one chapter and screenshot it, returning the PNG's byte length.
 *
 * WHY THIS IS MORE CAREFUL THAN IT LOOKS — inherited from the report-card
 * exporter, which once shipped a loading spinner to LinkedIn with every guard
 * green. `page.screenshot` captures the COMPOSITOR'S CURRENT FRAME, not the
 * DOM: after `domcontentloaded` the slide markup can be in the document while
 * the last painted frame is still the `app/loading.tsx` shell. Every DOM
 * assertion passes and the picture is a spinner — the DOM and the pixels are
 * different sources of truth, and only the pixels ship.
 *
 * So: wait for the slide to be *visible*, wait for the spinner to be *gone*,
 * then yield two animation frames so the current DOM is guaranteed to have
 * been painted before the shot.
 *
 * `[data-hub-slide]` rather than a class: hub.module.css class names are
 * hashed at build time and are not addressable from here.
 */
async function captureSlide(
  page: import("puppeteer").Page,
  url: string,
  n: number,
  out: string,
): Promise<number> {
  // domcontentloaded (not networkidle0): /hub is a server component so the
  // slide markup is in the initial HTML, and a deployed page's analytics
  // (Plausible) keep the network perpetually busy — networkidle0 never fires
  // against prod and the goto times out.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  // The deck reads ?slide=N in an effect, so the export attribute only appears
  // once React has hydrated. Waiting on it also proves hydration happened —
  // without it we would screenshot the un-pinned, full-width server render.
  await page
    .waitForSelector('[data-export="true"] [data-hub-slide]', {
      visible: true,
      timeout: 30_000,
    })
    .catch(() => {
      throw new Error(
        `slide ${n} did not render in export mode (hydration or data error?) at ${url}`,
      );
    });

  // The root loading fallback must be gone, not merely overlaid.
  await page.waitForFunction(() => !document.querySelector(".animate-spin"), {
    timeout: 30_000,
  });
  await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);

  // Strip the Next.js dev-mode indicator (only exists under `next dev`).
  await page.evaluate(() =>
    document.querySelectorAll("nextjs-portal").forEach((e) => e.remove()),
  );

  // Overflow guard: in export mode the slide is a fixed 1080×1350 box that
  // CLIPS overflow, so a long chapter would silently lose its footer in the
  // shipped PDF. Fail loud here instead. A MISSING element throws rather than
  // reading as a comfortably-short slide.
  const contentHeight = await page.evaluate(() => {
    const slide = document.querySelector('[data-export="true"] [data-hub-slide]');
    return slide ? slide.scrollHeight : -1;
  });
  if (contentHeight < 0) throw new Error(`slide ${n} vanished from the DOM before capture`);
  if (contentHeight > HEIGHT) {
    throw new Error(
      `slide ${n} content overflows the ${HEIGHT}px frame (scrollHeight ${contentHeight}) — ` +
        `the PDF would clip; tighten the chapter's copy or spacing`,
    );
  }

  // Two animation frames: the first schedules a paint of the current DOM, the
  // second resolves only once that paint has been committed.
  await page.evaluate(
    () =>
      new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r())),
      ),
  );
  await page.screenshot({
    path: out as `${string}.png`,
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });
  return (await fs.stat(out)).size;
}

async function main() {
  const base = (arg("base") ?? process.env.HUB_BASE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const outDir = path.resolve(arg("out") ?? "hub-carousel-out");
  await fs.mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

    const pngPaths: string[] = [];
    const sizes: number[] = [];
    for (let n = 1; n <= SLIDE_COUNT; n++) {
      const url = `${base}/hub?slide=${n}`;
      const out = path.join(outDir, `slide-${n}.png`);
      let bytes = 0;
      // Retry the whole capture: the blank-frame race is transient, so a
      // re-navigation fixes it. Better to self-heal than to fail the run.
      for (let attempt = 1; attempt <= 3; attempt++) {
        bytes = await captureSlide(page, url, n, out);
        if (bytes >= BLANK_PNG_BYTES) break;
        if (attempt === 3) {
          throw new Error(
            `slide ${n} captured blank ${attempt}x (${bytes} bytes — a rendered slide is ` +
              `>${BLANK_PNG_BYTES}); giving up rather than shipping an empty frame`,
          );
        }
        console.log(`  ⟳ slide ${n} captured blank (${bytes} bytes) — retrying`);
      }
      sizes.push(bytes);
      pngPaths.push(out);
      console.log(`✓ slide ${n} → ${out} (${Math.round(bytes / 1024)} KB)`);
    }

    // Relative blank check across the finished set. The absolute floor above
    // only catches a near-empty frame; this catches a slide that rendered but
    // lost most of its content, without a hand-tuned threshold — chapters share
    // a template, so their sizes cluster.
    const median = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
    const runts = sizes
      .map((b, i) => ({ n: i + 1, b }))
      .filter(({ b }) => b < median * 0.25);
    if (runts.length > 0) {
      throw new Error(
        `slide(s) ${runts.map((r) => r.n).join(", ")} are far smaller than the others ` +
          `(${runts.map((r) => `${r.n}=${Math.round(r.b / 1024)}KB`).join(", ")} vs median ` +
          `${Math.round(median / 1024)}KB) — they most likely captured a partly-rendered ` +
          `page; inspect the PNGs before publishing`,
      );
    }

    // Assemble the PNGs into a single 1080×1350-per-page PDF (Puppeteer only).
    const imgs = await Promise.all(
      pngPaths.map(
        async (p) => `data:image/png;base64,${(await fs.readFile(p)).toString("base64")}`,
      ),
    );
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:${WIDTH}px ${HEIGHT}px;margin:0;}
      html,body{margin:0;padding:0;}
      img{display:block;width:${WIDTH}px;height:${HEIGHT}px;page-break-after:always;}
      img:last-child{page-break-after:auto;}
    </style></head><body>${imgs.map((d) => `<img src="${d}">`).join("")}</body></html>`;
    const pdfPage = await browser.newPage();
    await pdfPage.setContent(html, { waitUntil: "load" });
    const pdfPath = path.join(outDir, "ask-arthur-hub.pdf");
    await pdfPage.pdf({
      path: pdfPath,
      width: `${WIDTH}px`,
      height: `${HEIGHT}px`,
      printBackground: true,
      pageRanges: `1-${SLIDE_COUNT}`,
    });
    console.log(`\n✓ PDF → ${pdfPath}`);
    console.log(`  (${SLIDE_COUNT} slides · upload as a LinkedIn document)`);
    console.log(`  Links inside a PDF are not tappable — the caption link does the work.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("hub carousel export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

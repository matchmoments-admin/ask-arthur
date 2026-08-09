/**
 * Clone-Watch report-card export — slice 3 of the monthly LinkedIn report.
 *
 * Screenshots each slide of /admin/report-card (via ?slide=N) at 1080×1350 and
 * assembles them into an upload-ready PDF (+ individual PNGs). Reuses the
 * Puppeteer already in the workspace — no new dependency, no Inngest, no cron.
 * You run it by hand:
 *
 *   # 1. have the web app running (dev or a preview URL)
 *   pnpm --filter @askarthur/web dev
 *   # 2. in another shell:
 *   ADMIN_SECRET=... pnpm --filter @askarthur/web report-card:export -- --month=2026-06
 *
 * Options (flags or env):
 *   --month=YYYY-MM     report month (default: prior calendar month)
 *   --base=URL          app base URL (default: http://localhost:3000)
 *   --out=DIR           output dir (default: ./report-card-out)
 * Requires ADMIN_SECRET (same value as the deployed app) to mint the admin
 * cookie — the page is requireAdmin()-gated.
 */
import "./_load-env-config";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

// Keep in sync with SLIDE_COUNT in app/admin/report-card/page.tsx.
const SLIDE_COUNT = 7;
const WIDTH = 1080;
const HEIGHT = 1350;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

/** Mirror of adminAuth.createAdminToken() (timestamp:nonce:hmac). Duplicated
 *  intentionally so this node script doesn't import the next/headers-bound
 *  adminAuth module. Keep in sync if the token format changes. */
function mintAdminToken(secret: string): string {
  const payload = `${Date.now()}:${crypto.randomBytes(16).toString("hex")}`;
  const hmac = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return `${payload}:${hmac}`;
}

/**
 * A rendered slide PNG is 220–380 KB at 2160×2700; the root `app/loading.tsx`
 * spinner on white compresses to ~25 KB. Anything under this floor is not a
 * slide. Deliberately coarse — it only has to separate "a page" from "a spinner".
 */
const BLANK_PNG_BYTES = 80_000;

/**
 * Navigate to one slide and screenshot it, returning the PNG's byte length.
 *
 * WHY THIS IS MORE CAREFUL THAN IT LOOKS — the July 2026 edition shipped a
 * loading spinner as slide 06 to LinkedIn with every guard green, and a re-run
 * reproduced it on slide 04. The old code checked the DOM (`page.$('.slide')`,
 * then `scrollHeight`) and screenshotted immediately. But `page.screenshot`
 * captures the COMPOSITOR'S CURRENT FRAME, not the DOM: after
 * `waitUntil: "domcontentloaded"` the streamed slide markup is in the document
 * while the last painted frame is still the `app/loading.tsx` shell. Every DOM
 * assertion passed and the picture was a spinner — the DOM and the pixels are
 * different sources of truth, and only the pixels ship.
 *
 * So: wait for the slide to be *visible*, wait for the spinner to be *gone*,
 * then yield two animation frames so the current DOM is guaranteed to have been
 * painted before the shot. The caller then checks the file the user will
 * actually see, which is the only check the spinner could not have passed.
 */
async function captureSlide(
  page: import("puppeteer").Page,
  url: string,
  n: number,
  out: string,
): Promise<number> {
  // domcontentloaded (not networkidle0): the route is a server component so the
  // .slide markup is in the initial HTML, and a deployed page's analytics
  // (Plausible) keep the network perpetually busy — networkidle0 never fires
  // against prod and the goto times out.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // `visible` (not a bare `$`) — an element that exists but has no box is the
  // shape a half-rendered page takes. A requireAdmin() redirect or a data error
  // lands us off-page and this times out, which is the intended failure.
  await page
    .waitForSelector(".rc-root.rc-solo .slide", { visible: true, timeout: 30_000 })
    .catch(() => {
      throw new Error(`slide ${n} did not render (auth/redirect/data error?) at ${url}`);
    });
  // The root loading fallback must be gone, not merely overlaid.
  await page.waitForFunction(() => !document.querySelector(".animate-spin"), {
    timeout: 30_000,
  });
  await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);
  // Strip the Next.js dev-mode indicator (a <nextjs-portal> element that only
  // exists under `next dev`; absent on the deployed app) so local screenshots
  // are clean.
  await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((e) => e.remove()));
  // Overflow guard: .slide is a fixed 1080×1350 box that CLIPS overflow, so a
  // heavy month (e.g. a long outcomes line on slide 06) would silently lose the
  // footer in the shipped PDF. Fail loud here — in the prepare job, before the
  // approval gate — instead. A MISSING element throws: the old version returned
  // 0 for "no element", i.e. it read absence as a comfortably-short slide.
  const contentHeight = await page.evaluate(() => {
    const slide = document.querySelector(".rc-root.rc-solo .slide");
    return slide ? slide.scrollHeight : -1;
  });
  if (contentHeight < 0) throw new Error(`slide ${n} vanished from the DOM before capture`);
  if (contentHeight > HEIGHT) {
    throw new Error(
      `slide ${n} content overflows the ${HEIGHT}px frame (scrollHeight ${contentHeight}) — the PDF would clip; tighten the slide's copy/spacing`,
    );
  }
  // Two animation frames: the first schedules a paint of the current DOM, the
  // second resolves only once that paint has been committed. This is what makes
  // the compositor frame match the DOM we just asserted on.
  await page.evaluate(
    () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.screenshot({ path: out as `${string}.png`, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  return (await fs.stat(out)).size;
}

async function main() {
  // Trim to match the server: adminAuth verifies with readStringEnv() (which
  // trims), so a stored secret with trailing whitespace would otherwise mint a
  // cookie whose HMAC the server rejects.
  const secret = process.env.ADMIN_SECRET?.trim();
  if (!secret) throw new Error("ADMIN_SECRET is required (same value as the deployed app)");

  const base = (arg("base") ?? process.env.REPORT_CARD_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const month = arg("month");
  const outDir = path.resolve(arg("out") ?? "report-card-out");
  await fs.mkdir(outDir, { recursive: true });

  const token = mintAdminToken(secret);
  const { hostname } = new URL(base);

  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
    await page.setCookie({ name: "__aa_admin", value: token, domain: hostname, path: "/" });

    const monthQ = month ? `&month=${month}` : "";
    const pngPaths: string[] = [];
    const sizes: number[] = [];
    for (let n = 1; n <= SLIDE_COUNT; n++) {
      const url = `${base}/admin/report-card?slide=${n}${monthQ}`;
      const out = path.join(outDir, `slide-${n}.png`);
      let bytes = 0;
      // Retry the whole capture: the blank-frame race below is transient, so a
      // re-navigation fixes it. Better to self-heal than to fail the monthly job.
      for (let attempt = 1; attempt <= 3; attempt++) {
        bytes = await captureSlide(page, url, n, out);
        if (bytes >= BLANK_PNG_BYTES) break;
        if (attempt === 3) {
          throw new Error(
            `slide ${n} captured blank ${attempt}x (${bytes} bytes — a rendered slide is >${BLANK_PNG_BYTES}); giving up rather than shipping a spinner`,
          );
        }
        console.log(`  ⟳ slide ${n} captured blank (${bytes} bytes) — retrying`);
      }
      sizes.push(bytes);
      pngPaths.push(out);
      console.log(`✓ slide ${n} → ${out} (${Math.round(bytes / 1024)} KB)`);
    }

    // Relative blank check, across the finished set. The absolute floor above
    // can only catch a page that is nearly all white; this catches a slide that
    // rendered but lost most of its content, without a hand-tuned threshold —
    // slides in one edition share a template, so their sizes cluster.
    const median = [...sizes].sort((a, b) => a - b)[Math.floor(sizes.length / 2)];
    const runts = sizes
      .map((b, i) => ({ n: i + 1, b }))
      .filter(({ b }) => b < median * 0.25);
    if (runts.length > 0) {
      throw new Error(
        `slide(s) ${runts.map((r) => r.n).join(", ")} are far smaller than the others ` +
          `(${runts.map((r) => `${r.n}=${Math.round(r.b / 1024)}KB`).join(", ")} vs median ${Math.round(median / 1024)}KB) — ` +
          `they most likely captured a partly-rendered page; inspect the PNGs before publishing`,
      );
    }

    // Assemble the PNGs into a single 1080×1350-per-page PDF (Puppeteer only).
    const imgs = await Promise.all(
      pngPaths.map(async (p) => `data:image/png;base64,${(await fs.readFile(p)).toString("base64")}`),
    );
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      @page{size:${WIDTH}px ${HEIGHT}px;margin:0;}
      html,body{margin:0;padding:0;}
      img{display:block;width:${WIDTH}px;height:${HEIGHT}px;page-break-after:always;}
      img:last-child{page-break-after:auto;}
    </style></head><body>${imgs.map((d) => `<img src="${d}">`).join("")}</body></html>`;
    const pdfPage = await browser.newPage();
    await pdfPage.setContent(html, { waitUntil: "load" });
    const pdfPath = path.join(outDir, `clone-watch-${month ?? "latest"}.pdf`);
    await pdfPage.pdf({ path: pdfPath, width: `${WIDTH}px`, height: `${HEIGHT}px`, printBackground: true, pageRanges: `1-${SLIDE_COUNT}` });
    console.log(`\n✓ PDF → ${pdfPath}`);
    console.log(`  (${SLIDE_COUNT} slides · upload as a LinkedIn document)`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("report-card export failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

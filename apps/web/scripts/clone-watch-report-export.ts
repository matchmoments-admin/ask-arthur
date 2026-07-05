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
import "dotenv/config";
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
    for (let n = 1; n <= SLIDE_COUNT; n++) {
      const url = `${base}/admin/report-card?slide=${n}${monthQ}`;
      // domcontentloaded (not networkidle0): the route is a server component so
      // the .slide markup is in the initial HTML, and a deployed page's analytics
      // (Plausible) keep the network perpetually busy — networkidle0 never fires
      // against prod and the goto times out. The .slide + fonts.ready guards below
      // handle render/font readiness.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      // Guard: a requireAdmin() redirect or an error would land us off-page.
      const ok = await page.$(".rc-root.rc-solo .slide");
      if (!ok) throw new Error(`slide ${n} did not render (auth/redirect/data error?) at ${url}`);
      await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);
      // Strip the Next.js dev-mode indicator (a <nextjs-portal> element that
      // only exists under `next dev`; absent on the deployed app) so local
      // screenshots are clean.
      await page.evaluate(() => document.querySelectorAll("nextjs-portal").forEach((e) => e.remove()));
      const out = path.join(outDir, `slide-${n}.png`);
      await page.screenshot({ path: out as `${string}.png`, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      pngPaths.push(out);
      console.log(`✓ slide ${n} → ${out}`);
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

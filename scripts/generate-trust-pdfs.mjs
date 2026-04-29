#!/usr/bin/env node
// Generate the Ask Arthur trust documents (Security Overview, DPA template) as PDFs.
//
// Why a script and not a build step:
//   - These docs change quarterly at most. Re-rendering on every Vercel deploy
//     wastes CI time and creates noisy PDF binary diffs in PRs.
//   - The CSS is authored in apps/web/app/trust/document.css against print rules
//     that puppeteer respects. Same source for the live HTML and the PDF.
//
// Usage:
//   1. In one terminal: pnpm --filter @askarthur/web dev
//   2. In another:      pnpm trust:pdfs
//
// Or against a remote host (preview / prod):
//   BASE_URL=https://askarthur.au pnpm trust:pdfs
//
// Outputs land in apps/web/public/legal/ — commit them so the download links
// resolve in production without the dev server needing to run.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import puppeteer from "puppeteer";

const BASE_URL = process.env.BASE_URL?.replace(/\/$/, "") || "http://localhost:3000";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "apps", "web", "public", "legal");

/** @type {Array<{ slug: string; route: string; output: string; title: string }>} */
const docs = [
  {
    slug: "security-overview",
    route: "/trust/security-overview",
    output: "ask-arthur-security-overview-v1.pdf",
    title: "Ask Arthur · Security Overview",
  },
  {
    slug: "dpa",
    route: "/trust/dpa",
    output: "ask-arthur-dpa-template-v1.pdf",
    title: "Ask Arthur · Data Processing Agreement (Template)",
  },
];

async function ping(url) {
  try {
    const r = await fetch(url, { method: "HEAD" });
    return r.ok || r.status === 404 || r.status === 405;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`[trust-pdfs] base url: ${BASE_URL}`);

  if (!(await ping(BASE_URL))) {
    console.error(
      `\n[trust-pdfs] ERROR: ${BASE_URL} is not reachable.\n` +
        `Start the web dev server first:\n  pnpm --filter @askarthur/web dev\n` +
        `Or set BASE_URL to a deployed origin (e.g. preview URL).\n`
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  try {
    for (const doc of docs) {
      const url = `${BASE_URL}${doc.route}`;
      console.log(`[trust-pdfs] rendering ${doc.slug} from ${url}`);

      const page = await browser.newPage();
      // Match the print media so puppeteer evaluates @media print rules during
      // both layout and the PDF render. Without this it screenshots the screen
      // version with the Nav header stripped only via display:none in print.
      await page.emulateMediaType("print");
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });

      // Wait for fonts to settle so the cover title doesn't render in fallback
      // sans-serif then re-flow during print.
      await page.evaluateHandle("document.fonts.ready");

      const outPath = path.join(OUT_DIR, doc.output);
      await page.pdf({
        path: outPath,
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      });

      console.log(`[trust-pdfs]   → ${path.relative(process.cwd(), outPath)}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // Sub-processor CSV — emit alongside the PDFs so /trust/sub-processors
  // stays the canonical source.
  const csv = [
    ["provider", "region", "purpose", "certifications"].join(","),
    ["Supabase, Inc.", "USA / Sydney", "Database hosting", "SOC 2 Type II"],
    ["Vercel, Inc.", "USA / Sydney", "Application hosting", "SOC 2 + ISO 27001"],
    ["Cloudflare, Inc.", "USA / Oceania", "CDN + object storage", "SOC 2 + ISO 27001"],
    ["Anthropic, PBC", "USA", "AI analysis", "Enterprise DPA; SOC 2"],
    ["Twilio, Inc.", "USA", "Phone intelligence", "SOC 2 Type II"],
    ["Upstash, Inc.", "Singapore", "Rate limiting", "SOC 2"],
    ["Resend, Inc.", "USA", "Email delivery", "SOC 2"],
    ["Stripe, Inc.", "USA", "Billing", "PCI DSS Level 1; SOC 2"],
  ]
    .map((row) =>
      Array.isArray(row) ? row.map(csvCell).join(",") : row
    )
    .join("\n");

  const csvPath = path.join(OUT_DIR, "ask-arthur-sub-processors-v1.csv");
  await writeFile(csvPath, csv + "\n", "utf8");
  console.log(`[trust-pdfs]   → ${path.relative(process.cwd(), csvPath)}`);

  console.log(`\n[trust-pdfs] done. Commit the contents of ${path.relative(process.cwd(), OUT_DIR)} to ship.`);
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[,"\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

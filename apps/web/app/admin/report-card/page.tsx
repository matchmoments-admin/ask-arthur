import { Archivo, JetBrains_Mono } from "next/font/google";
import { requireAdmin } from "@/lib/adminAuth";
import {
  getCloneWatchReportCard,
  type CloneWatchReportCard,
} from "@/lib/clone-watch/report-card-data";
import { reportCardCss } from "./report-card-css";

/**
 * /admin/report-card - renders the monthly "Australian Clone Watch" LinkedIn
 * carousel from live data, in the "Modern LinkedIn monthly report" ledger style
 * (ported from the user's claude.ai/design project). Read-only, on-demand: NO
 * Inngest, NO cron, one SELECT per render. The Puppeteer export script hits
 * ?slide=N for each slide.
 *
 * Query params:
 *   ?month=YYYY-MM   the report month (default: prior calendar month)
 *   ?slide=N         render ONLY slide N full-bleed (1080x1350) for export;
 *                    omit to preview all slides stacked.
 *
 * Rendered full-bleed via position:fixed so it escapes the /admin AdminShell
 * chrome (which has no transformed ancestor - verified) for clean screenshots.
 */

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap", variable: "--font-archivo" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap", variable: "--font-jbmono" });

export const dynamic = "force-dynamic";

const SLIDE_COUNT = 3;

export default async function ReportCardPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; slide?: string }>;
}) {
  await requireAdmin();
  const { month, slide } = await searchParams;

  let data: CloneWatchReportCard;
  try {
    data = await getCloneWatchReportCard(month);
  } catch (err) {
    return (
      <pre style={{ padding: 32, fontFamily: "monospace" }}>
        report-card error: {err instanceof Error ? err.message : String(err)}
      </pre>
    );
  }

  const only = slide ? Math.min(Math.max(parseInt(slide, 10) || 1, 1), SLIDE_COUNT) : null;
  const slides = Array.from({ length: SLIDE_COUNT }, (_, i) => i + 1).filter(
    (n) => only == null || n === only,
  );

  return (
    <div className={`${archivo.variable} ${jbMono.variable} rc-root${only ? " rc-solo" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: reportCardCss }} />
      {slides.map((n) => (
        <Slide key={n} n={n} data={data} />
      ))}
    </div>
  );
}

function Slide({ n, data }: { n: number; data: CloneWatchReportCard }) {
  if (n === 1) return <SlideHook data={data} />;
  if (n === 2) return <SlideData data={data} />;
  return <SlideTakeaway data={data} />;
}

/* ── Card 1 — hook ───────────────────────────────────────────────────────── */
function SlideHook({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">CLONE WATCH</span>
        <span className="r">ASK ARTHUR · {period}</span>
      </div>
      <div className="hero">
        <div className="eyebrow">LOOKALIKE DOMAINS DETECTED</div>
        <div className="heronum">{data.total}</div>
        <div className="herobar" />
        <p className="lead">
          newly-registered <b>copycat domains</b> built to mimic <b>{data.brands} brands</b> Australians use every day — in a single month.
        </p>
      </div>
      <div className="kpis">
        <div className="kpi accent"><div className="n">{data.kpis.reportedToNetcraft}</div><div className="l">reported to Netcraft for takedown review</div></div>
        <div className="kpi"><div className="n">{data.kpis.likelyPhishing}</div><div className="l">flagged as likely phishing</div></div>
        <div className="kpi"><div className="n">{data.kpis.parkedForSale}</div><div className="l">parked / squatting domains</div></div>
      </div>
      <div className="note">Lookalike domain = a freshly-registered address made to resemble a real brand. Detected, not all confirmed malicious.</div>
      <div className="foot">
        <div className="brandline"><b>askarthur.au</b> <span>— free scam &amp; clone checker</span></div>
        <span className="page">01 <span className="tot">/ 03</span></span>
      </div>
    </section>
  );
}

/* ── Card 2 — data ───────────────────────────────────────────────────────── */
function SlideData({ data }: { data: CloneWatchReportCard }) {
  const max = data.topAuBrands[0]?.clones ?? 1;
  const period = data.periodLabel.toUpperCase();
  const globals = data.globalBrands.map((b) => `${prettyBrand(b.brand)} (${b.clones})`).join(", ");
  const regs = data.topRegistrars.slice(0, 3).map((r) => `${r.registrar} ${r.clones}`).join(" · ");
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">MOST-TARGETED</span>
        <span className="r">PER BRAND · {period}</span>
      </div>
      <h2 className="h2">The Australian brands most impersonated</h2>
      <div className="subhead">Copycat domains detected per brand.</div>
      <div className="rows">
        {data.topAuBrands.map((b, i) => (
          <div className="row" key={b.brand}>
            <div className="name">{b.brand}</div>
            <div className="track"><div className={`fill${i === 0 ? " accent" : ""}`} style={{ width: `${((b.clones / max) * 100).toFixed(1)}%` }} /></div>
            <div className={`val${i === 0 ? " accent" : ""}`}>{b.clones}</div>
          </div>
        ))}
      </div>
      {globals && <p className="globals"><b>Global brands, too:</b> {globals} — all aimed at Australians.</p>}
      <div className="foot rule2 bot">
        <div className="reg">Registrars: {regs}{data.unknownRegistrarCount > 0 ? ` · ${data.unknownRegistrarCount} WHOIS-hidden` : ""}</div>
        <span className="page">02 <span className="tot">/ 03</span></span>
      </div>
    </section>
  );
}

/* ── Card 3 — takeaway ───────────────────────────────────────────────────── */
function SlideTakeaway({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">WHAT IT MEANS</span>
        <span className="r">ASK ARTHUR · {period}</span>
      </div>
      <h2 className="h2b">The address bar is the front line.</h2>
      <div className="steps">
        <div className="step"><span className="sn">01</span><p>A copycat domain is <b>cheap, fast and disposable</b> — thousands go up every month.</p></div>
        <div className="step"><span className="sn">02</span><p>The message can look perfect. <b>The web address is where it slips.</b></p></div>
        <div className="step"><span className="sn">03</span><p>Before you log in or pay: <b>check the link, not just the logo.</b></p></div>
      </div>
      <div className="know">
        <div className="lab">HOW WE KNOW</div>
        <div className="txt">We sweep newly-registered domains against ~50 major Australian brands daily, enrich with WHOIS + certificate data, and review by hand — each with a public evidence page on urlscan.io.</div>
      </div>
      <div className="close">
        <div className="cta">Check any link at<br /><a href="https://askarthur.au">askarthur.au</a></div>
        <p className="partner">Targeted brand? We share the full clone list with affected brands — partner with us at <a href="https://askarthur.au/contact">askarthur.au/contact</a></p>
        <div className="foot rule2" style={{ marginTop: 28 }}>
          <span className="mono" style={{ fontSize: 22, color: "var(--muted)" }}>Australian Clone Watch · published monthly</span>
          <span className="page">03 <span className="tot">/ 03</span></span>
        </div>
      </div>
    </section>
  );
}

/** Correct display casing for brands whose name isn't a naive capitalise-first
 *  (only needs the ones that can surface in the global footnote). */
const BRAND_DISPLAY: Record<string, string> = {
  whatsapp: "WhatsApp",
  paypal: "PayPal",
  hellostake: "Stake",
  aliexpress: "AliExpress",
  fedex: "FedEx",
  shein: "SHEIN",
  iinet: "iiNet",
  ebay: "eBay",
  youtube: "YouTube",
};

/** "target.com.au" → "Target"; strips the TLD and applies a display-name
 *  override where naive capitalise-first would look wrong. */
function prettyBrand(domain: string): string {
  const label = (domain.split(".")[0] ?? domain).toLowerCase();
  return BRAND_DISPLAY[label] ?? label.charAt(0).toUpperCase() + label.slice(1);
}

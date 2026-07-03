import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { requireAdmin } from "@/lib/adminAuth";
import {
  getCloneWatchReportCard,
  type CloneWatchReportCard,
} from "@/lib/clone-watch/report-card-data";
import { reportCardCss } from "./report-card-css";

/**
 * /admin/report-card — renders the monthly "Australian Clone Watch" LinkedIn
 * carousel from live data, in the Swiss deck house style. Read-only, on-demand:
 * NO Inngest, NO cron, one SELECT per render. The Playwright/Puppeteer export
 * script (scripts/clone-watch-report-export.ts) hits `?slide=N` for each slide.
 *
 * Query params:
 *   ?month=YYYY-MM   the report month (default: prior calendar month)
 *   ?slide=N         render ONLY slide N full-bleed (1080×1350) for export;
 *                    omit to preview all slides stacked.
 *
 * Rendered full-bleed via position:fixed so it escapes the /admin AdminShell
 * chrome (which has no transformed ancestor — verified) for clean screenshots.
 */

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap", variable: "--font-archivo" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], display: "swap", variable: "--font-plex-mono" });

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
  const slides = [1, 2, 3].filter((n) => only == null || n === only);

  return (
    <div className={`${archivo.variable} ${plexMono.variable} rc-root${only ? " rc-solo" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: reportCardCss }} />
      {slides.map((n) => (
        <Slide key={n} n={n} data={data} />
      ))}
    </div>
  );
}

function Slide({ n, data }: { n: number; data: CloneWatchReportCard }) {
  if (n === 1) return <SlideHero data={data} />;
  if (n === 2) return <SlideBrands data={data} />;
  return <SlideMeaning data={data} />;
}

/* ── Slide 1 — hero + reporting KPIs ─────────────────────────────────────── */
function SlideHero({ data }: { data: CloneWatchReportCard }) {
  return (
    <section className="slide dk">
      <div className="go" />
      <div className="pad">
        <div className="eb"><span className="bar" /><span className="num mono">01</span><span className="lab">Ask Arthur · Clone Watch</span></div>
        <div className="spacer" />
        <p className="kicker gb">Lookalike domains detected — {data.periodLabel}</p>
        <div className="big">{data.total}</div>
        <p className="lead lb" style={{ marginTop: 22, maxWidth: 840 }}>
          newly-registered <b>copycat domains</b> built to mimic <b>{data.brands} brands</b> Australians use every day — in a single month.
        </p>
        <div className="kstrip">
          <div className="k"><div className="n g">{data.kpis.reportedToNetcraft}</div><div className="l">reported to Netcraft for takedown review</div></div>
          <div className="k"><div className="n">{data.kpis.confirmed}</div><div className="l">operator-confirmed as clones</div></div>
          <div className="k"><div className="n">{data.kpis.likelyPhishing}</div><div className="l">flagged as likely phishing</div></div>
        </div>
        <div className="spacer" />
        <p className="mono note">Lookalike domain = a freshly-registered address made to resemble a real brand. Detected, not all confirmed malicious.</p>
        <div className="foot"><span><b className="w">askarthur.au</b> · free scam checker</span><span>{data.periodLabel}</span></div>
      </div>
    </section>
  );
}

/* ── Slide 2 — top AU brands + global footnote + registrar line ──────────── */
function SlideBrands({ data }: { data: CloneWatchReportCard }) {
  const max = data.topAuBrands[0]?.clones ?? 1;
  const globals = data.globalBrands.map((b) => `${prettyBrand(b.brand)} (${b.clones})`).join(", ");
  const regs = data.topRegistrars.slice(0, 3).map((r) => `${r.registrar} ${r.clones}`).join(" · ");
  return (
    <section className="slide">
      <div className="go" />
      <div className="pad">
        <div className="eb"><span className="bar" /><span className="num mono">02</span><span className="lab">Most-targeted</span></div>
        <h2 style={{ marginTop: 30 }}>The Australian brands<br />most impersonated</h2>
        <p className="lead" style={{ marginTop: 16 }}>Copycat domains detected per brand — {data.periodLabel}.</p>
        <div className="rows">
          {data.topAuBrands.map((b, i) => (
            <div className="row" key={b.brand}>
              <span className="name">{b.brand}</span>
              <span className="track"><span className={`fill${i === 0 ? " g" : ""}`} style={{ width: `${Math.round((b.clones / max) * 100)}%` }} /></span>
              <span className="val">{b.clones}</span>
            </div>
          ))}
        </div>
        <div className="spacer" />
        {globals && <p className="lead" style={{ fontSize: 24 }}><b className="ink">Global brands too:</b> {globals} — all aimed at Australians.</p>}
        <div className="foot"><span>Registrars enabling them: {regs}</span><span><b>askarthur.au</b></span></div>
      </div>
    </section>
  );
}

/* ── Slide 3 — so-what + method/evidence + CTA ───────────────────────────── */
function SlideMeaning({ data }: { data: CloneWatchReportCard }) {
  return (
    <section className="slide dk">
      <div className="go" />
      <div className="pad">
        <div className="eb"><span className="bar" /><span className="num mono">03</span><span className="lab">What it means</span></div>
        <h2 style={{ marginTop: 34, maxWidth: 900 }}>The address bar is<br />the front line.</h2>
        <ul className="pts">
          <li>A copycat domain is <b>cheap, fast and disposable</b> — thousands go up every month.</li>
          <li>The message can look perfect. <b>The web address is where it slips.</b></li>
          <li>Before you log in or pay: <b>check the link, not just the logo.</b></li>
        </ul>
        <div className="spacer" />
        <span className="tag"><span className="dot" />How we know — and how you can check</span>
        <p className="evi">We sweep newly-registered domains against ~50 major Australian brands daily, enrich each with WHOIS + certificate data, and review by hand. Every reported domain has an independent public evidence page on urlscan.io — full URL-level list available on request.</p>
        <h2 style={{ fontSize: 42, marginTop: 30 }}>Check before you click.<br /><span className="accent">askarthur.au</span></h2>
        <p className="mono disc">Ask Arthur is a free scam-detection tool by Young Milton Pty Ltd (Sydney). Not affiliated with any bank or government agency. Figures are lookalike domains detected in {data.periodLabel}; detection does not confirm malicious intent.</p>
        <div className="foot"><span><b className="w">Australian Clone Watch</b> · {data.periodLabel}</span><span>We publish this monthly</span></div>
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

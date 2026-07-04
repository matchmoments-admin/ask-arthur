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
 * Inngest, NO cron, two SELECTs per render (report month + prior month for the
 * MoM delta). The Puppeteer export script hits ?slide=N for each slide.
 *
 * Super-hook-led 8-slide structure:
 *   01 hook (the number)        05 global brands aimed at AU
 *   02 scale + MoM delta        06 registrar accountability (aggregate)
 *   03 top AU brands            07 what we did (reported / phishing / parked)
 *   04 why a lookalike works    08 civic CTA + method link
 *
 * Query params:
 *   ?month=YYYY-MM   the report month (default: prior calendar month)
 *   ?slide=N         render ONLY slide N full-bleed (1080x1350) for export;
 *                    omit to preview all slides stacked.
 *
 * Rendered full-bleed via position:fixed so it escapes the /admin AdminShell
 * chrome (which has no transformed ancestor - verified) for clean screenshots.
 *
 * Framing guardrails baked in (per the honesty guardrails memory): "lookalike /
 * copycat / suspected", never "confirmed clones"; Netcraft = reported for review,
 * NOT taken down; registrars shown ONLY in aggregate (no single-registrar
 * shaming); the MoM window is always stated, and a delta only shows once both
 * months are fully tracked (see FIRST_FULL_MONTH in report-card-data.ts).
 */

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap", variable: "--font-archivo" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap", variable: "--font-jbmono" });

export const dynamic = "force-dynamic";

const SLIDE_COUNT = 8;
const TOT = String(SLIDE_COUNT).padStart(2, "0");

/** "01 / 08" page marker in the footer rule. */
function Pg({ n }: { n: number }) {
  return (
    <span className="page">
      {String(n).padStart(2, "0")} <span className="tot">/ {TOT}</span>
    </span>
  );
}

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
  switch (n) {
    case 1: return <SlideHook data={data} />;
    case 2: return <SlideScale data={data} />;
    case 3: return <SlideAuBrands data={data} />;
    case 4: return <SlideSuperFund data={data} />;
    case 5: return <SlideGlobal data={data} />;
    case 6: return <SlideRegistrars data={data} />;
    case 7: return <SlideActed data={data} />;
    default: return <SlideClose data={data} />;
  }
}

/* ── 01 — hook (the number) ──────────────────────────────────────────────── */
function SlideHook({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">CLONE WATCH</span>
        <span className="r">ASK ARTHUR · {period}</span>
      </div>
      <div className="hero hero-lg">
        <div className="eyebrow">LOOKALIKE DOMAINS DETECTED</div>
        <div className="heronum">{data.total}</div>
        <div className="herobar" />
        <p className="lead">
          newly-registered <b>copycat domains</b> built to mimic <b>{data.brands} brands</b> Australians use every day — in a single month.
        </p>
      </div>
      <div className="note">Lookalike domain = a freshly-registered address made to resemble a real brand. Detected, not all confirmed malicious.</div>
      <div className="foot">
        <div className="brandline"><b>askarthur.au</b> <span>— free scam &amp; clone checker</span></div>
        <Pg n={1} />
      </div>
    </section>
  );
}

/* ── 02 — scale + month-on-month delta ───────────────────────────────────── */
function SlideScale({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  const { mom } = data;
  const perBrand = Math.round(data.total / Math.max(data.brands, 1));
  const perDay = Math.round(data.total / 30);
  const dir = mom.totalDelta > 0 ? "up" : mom.totalDelta < 0 ? "down" : "flat";
  const arrow = mom.totalDelta > 0 ? "▲" : mom.totalDelta < 0 ? "▼" : "—";
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">THE SCALE</span>
        <span className="r">{period}</span>
      </div>
      <h2 className="h2" style={{ marginTop: 34 }}>One month of copycats</h2>
      <div className="subhead">Newly-registered lookalike domains, {data.periodLabel}.</div>

      {mom.available ? (
        <>
          <div className="momrow">
            <span className="mombig">{data.total}</span>
            <span className={`delta ${dir}`}>{arrow} {mom.totalPct != null ? `${Math.abs(mom.totalPct)}%` : ""}</span>
          </div>
          <p className="cmpline">
            <b>{mom.priorTotal}</b> in {mom.priorLabel} → <b>{data.total}</b> in {data.periodLabel}
            {mom.brandsDelta !== 0 && <> · {mom.brandsDelta > 0 ? "+" : ""}{mom.brandsDelta} brands targeted</>}.
          </p>
        </>
      ) : (
        <>
          <div className="momrow"><span className="mombig">{data.total}</span></div>
          <p className="baseline">
            {data.periodLabel} is our <b>first full month</b> of tracking — the baseline every future Clone Watch is measured against.
          </p>
        </>
      )}

      <div className="statstrip">
        <div className="st"><div className="n">{data.brands}</div><div className="l">Australian brands targeted</div></div>
        <div className="st"><div className="n">{perBrand}</div><div className="l">copycats per brand (avg)</div></div>
        <div className="st"><div className="n accent">{perDay}</div><div className="l">new lookalikes a day</div></div>
      </div>
      <div className="foot">
        <div className="brandline"><b>askarthur.au</b> <span>— free scam &amp; clone checker</span></div>
        <Pg n={2} />
      </div>
    </section>
  );
}

/* ── 03 — top AU brands ──────────────────────────────────────────────────── */
function SlideAuBrands({ data }: { data: CloneWatchReportCard }) {
  const max = data.topAuBrands[0]?.clones ?? 1;
  const period = data.periodLabel.toUpperCase();
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
      <div className="foot rule2 bot">
        <div className="reg">Ranked by lookalike domains detected in {data.periodLabel}. Suspected impersonation — detection does not confirm intent.</div>
        <Pg n={3} />
      </div>
    </section>
  );
}

/** "the most-targeted" / "the 2nd most-targeted" / … from a 1-based rank. */
function auRankPhrase(rank: number): string {
  if (rank <= 1) return "the most-targeted";
  const ord = rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;
  return `the ${ord} most-targeted`;
}

/* ── 04 — super-fund spotlight (falls back to anatomy if no fund appears) ─── */
function SlideSuperFund({ data }: { data: CloneWatchReportCard }) {
  const sf = data.superFund;
  if (!sf) return <SlideAnatomy data={data} />;
  const period = data.periodLabel.toUpperCase();
  const name = prettyBrand(sf.brand);
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">THE SUPER-FUND ANGLE</span>
        <span className="r">SUPER FUND · {period}</span>
      </div>
      <h2 className="h2b sf">A super fund was {auRankPhrase(sf.auRank)}<br />Australian brand.</h2>
      <div className="spotstat">
        <span className="spotnum">{sf.clones}</span>
        <span className="spotname">{name}<span>lookalike domains · {data.periodLabel}</span></span>
      </div>
      <p className="spotlead">Retirement savings are a front-line target now — <b>not just your bank login.</b> One super-fund password can open a lifetime of savings.</p>
      <div className="note">Lookalike domains impersonating {name}; {name} is the targeted party, not the source. Detected, not all confirmed malicious.</div>
      <div className="foot rule2 bot">
        <div className="reg">Ranked among Australian (.au) brands by lookalike domains detected in {data.periodLabel}.</div>
        <Pg n={4} />
      </div>
    </section>
  );
}

/* ── 04b — why a lookalike works (fallback when no super fund appears) ────── */
function SlideAnatomy({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">WHY IT WORKS</span>
        <span className="r">ASK ARTHUR · {period}</span>
      </div>
      <h2 className="h2b">The address bar is the front line.</h2>
      <div className="steps">
        <div className="step"><span className="sn">01</span><p>A copycat domain is <b>cheap, fast and disposable</b> — thousands go up every month.</p></div>
        <div className="step"><span className="sn">02</span><p>The message can look perfect. <b>The web address is where it slips.</b></p></div>
        <div className="step"><span className="sn">03</span><p>Before you log in or pay: <b>check the link, not just the logo.</b></p></div>
      </div>
      <div className="foot rule2" style={{ marginTop: "auto" }}>
        <span className="mono" style={{ fontSize: 22, color: "var(--muted)" }}>Anatomy of a lookalike domain</span>
        <Pg n={4} />
      </div>
    </section>
  );
}

/* ── 05 — global brands aimed at Australians ─────────────────────────────── */
function SlideGlobal({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  const max = data.globalBrands[0]?.clones ?? 1;
  const hasGlobals = data.globalBrands.length > 0;
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">NOT JUST LOCAL</span>
        <span className="r">GLOBAL BRANDS · {period}</span>
      </div>
      <h2 className="h2">Global brands, aimed at Australians</h2>
      <div className="subhead">International brands cloned to target AU users, {data.periodLabel}.</div>
      {hasGlobals ? (
        <div className="rows">
          {data.globalBrands.map((b, i) => (
            <div className="row" key={b.brand}>
              <div className="name">{prettyBrand(b.brand)}</div>
              <div className="track"><div className={`fill${i === 0 ? " accent" : ""}`} style={{ width: `${((b.clones / max) * 100).toFixed(1)}%` }} /></div>
              <div className={`val${i === 0 ? " accent" : ""}`}>{b.clones}</div>
            </div>
          ))}
        </div>
      ) : (
        <p className="globals" style={{ marginTop: 40 }}>No international-brand lookalikes surfaced this month — the copycats stayed local.</p>
      )}
      <p className="globals">Registered abroad, pointed at Australia — a lookalike doesn&apos;t care where a brand is based.</p>
      <div className="foot rule2 bot">
        <div className="reg">Global = brand on a non-AU TLD. Detected {data.periodLabel}; suspected impersonation.</div>
        <Pg n={5} />
      </div>
    </section>
  );
}

/* ── 06 — registrar accountability (aggregate only) ──────────────────────── */
function SlideRegistrars({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  const regs = data.topRegistrars.slice(0, 6);
  const max = regs[0]?.clones ?? 1;
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">WHERE THEY&apos;RE REGISTERED</span>
        <span className="r">IN AGGREGATE · {period}</span>
      </div>
      <h2 className="h2">Who the clones register through</h2>
      <div className="subhead">Domain registrars by lookalike count — aggregate, not a callout.</div>
      <div className="rows">
        {regs.map((r, i) => (
          <div className="row" key={r.registrar}>
            <div className="name reg-name">{r.registrar}</div>
            <div className="track"><div className={`fill${i === 0 ? " accent" : ""}`} style={{ width: `${((r.clones / max) * 100).toFixed(1)}%` }} /></div>
            <div className={`val${i === 0 ? " accent" : ""}`}>{r.clones}</div>
          </div>
        ))}
      </div>
      <div className="know" style={{ marginTop: 36 }}>
        <div className="lab">THE ANONYMITY GAP</div>
        <div className="txt"><b style={{ color: "var(--ink)" }}>{data.unknownRegistrarCount}</b> of {data.total} lookalike domains hide their registrar behind WHOIS privacy — no name attached to the registration at all.</div>
      </div>
      <div className="foot rule2 bot">
        <div className="reg">Registrars named in aggregate for accountability, not to single any one out.</div>
        <Pg n={6} />
      </div>
    </section>
  );
}

/* ── 07 — what we did (reported / phishing / parked) ─────────────────────── */
function SlideActed({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">WHAT WE DID</span>
        <span className="r">ASK ARTHUR · {period}</span>
      </div>
      <h2 className="h2b">Detected — then acted.</h2>
      <div className="kpis" style={{ marginTop: 40 }}>
        <div className="kpi accent"><div className="n">{data.kpis.reportedToNetcraft}</div><div className="l">reported to Netcraft for takedown review</div></div>
        <div className="kpi"><div className="n">{data.kpis.likelyPhishing}</div><div className="l">flagged as likely phishing</div></div>
        <div className="kpi"><div className="n">{data.kpis.parkedForSale}</div><div className="l">parked / squatting domains</div></div>
      </div>
      <div className="know" style={{ marginTop: 56 }}>
        <div className="lab">HOW WE KNOW</div>
        <div className="txt">We sweep newly-registered domains against ~50 major Australian brands daily, enrich with WHOIS + certificate data, and review by hand — each with a public evidence page on urlscan.io.</div>
      </div>
      <div className="note">Reported to Netcraft for review is a takedown <b>request</b>, not a confirmed takedown.</div>
      <div className="foot rule2 bot">
        <div className="reg">Full URL-level evidence list available to affected brands on request.</div>
        <Pg n={7} />
      </div>
    </section>
  );
}

/* ── 08 — civic CTA + method link ────────────────────────────────────────── */
function SlideClose({ data }: { data: CloneWatchReportCard }) {
  const period = data.periodLabel.toUpperCase();
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">CHECK BEFORE YOU CLICK</span>
        <span className="r">ASK ARTHUR · {period}</span>
      </div>
      <h2 className="h2b">Check the link,<br />not just the logo.</h2>
      <div className="know">
        <div className="lab">HOW WE KNOW — AND HOW YOU CAN CHECK</div>
        <div className="txt">Our method, sources and definitions are public at <b style={{ color: "var(--rust)" }}>askarthur.au/clone-watch</b> — every reported domain links to independent evidence on urlscan.io.</div>
      </div>
      <div className="close">
        <div className="cta">Check any link at<br /><a href="https://askarthur.au">askarthur.au</a></div>
        <p className="partner">Targeted brand? We share the full clone list with affected brands — partner with us at <a href="https://askarthur.au/contact">askarthur.au/contact</a></p>
        <div className="foot rule2" style={{ marginTop: 28 }}>
          <span className="mono" style={{ fontSize: 22, color: "var(--muted)" }}>Australian Clone Watch · {data.periodLabel} · published monthly</span>
          <Pg n={8} />
        </div>
      </div>
    </section>
  );
}

/** Correct display casing for brands whose name isn't a naive capitalise-first
 *  (covers both the AU ranking and the global footnote). */
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
  // AU super funds (for the spotlight name — proper casing, not capitalise-first)
  hesta: "HESTA",
  australiansuper: "AustralianSuper",
  unisuper: "UniSuper",
  hostplus: "Hostplus",
  aware: "Aware Super",
  cbus: "Cbus",
  rest: "Rest Super",
  caresuper: "CareSuper",
  ngssuper: "NGS Super",
  telstrasuper: "TelstraSuper",
  visionsuper: "Vision Super",
  spiritsuper: "Spirit Super",
};

/** "target.com.au" → "Target"; strips the TLD and applies a display-name
 *  override where naive capitalise-first would look wrong. */
function prettyBrand(domain: string): string {
  const label = (domain.split(".")[0] ?? domain).toLowerCase();
  return BRAND_DISPLAY[label] ?? label.charAt(0).toUpperCase() + label.slice(1);
}

import { Archivo, JetBrains_Mono } from "next/font/google";
import { createServiceClient } from "@askarthur/supabase/server";
import { requireAdmin } from "@/lib/adminAuth";
import {
  getCloneWatchReportCard,
  type CloneWatchReportCard,
} from "@/lib/clone-watch/report-card-data";
import {
  formatMedianHours,
  medianOf,
  MEDIAN_FLOOR,
  type DurationLeg,
} from "@/lib/clone-watch/duration-kpis";
import { logger } from "@askarthur/utils/logger";
import { buildOutcomesLine } from "@/lib/clone-watch/outcome-copy";
import { buildClassifierCaveat, tacticLabel } from "@/lib/clone-watch/targeting-copy";
import { prettyBrand } from "@/lib/clone-watch/brand-display";
import { reportCardCss } from "./report-card-css";

/**
 * /admin/report-card - renders the monthly "Australian Clone Watch" LinkedIn
 * carousel from live data, in the "Modern LinkedIn monthly report" ledger style
 * (ported from the user's claude.ai/design project). Read-only, on-demand: NO
 * Inngest, NO cron, two SELECTs per render (report month + prior month — the
 * prior-month read feeds `mom`, retained for the conditional MoM/scale slide the
 * recurring-automation build re-introduces once July-vs-June has a real delta).
 * The Puppeteer export script hits ?slide=N for each slide.
 *
 * Super-hook-led 7-slide structure:
 *   01 hook (the number)              05 what it means (address bar / anatomy)
 *   02 top AU brands                  06 what we did (reported / phishing / parked)
 *   03 super-fund spotlight (HESTA;   07 civic CTA + method link
 *      falls back to global brands)
 *   04 registrar accountability (aggregate)
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
 * Vendor OUTCOMES (slide 06, since the v217+ reconciler): the copy comes from
 * lib/clone-watch/outcome-copy.ts — the single vocabulary module whose header
 * states the honesty rules (exclusive lifecycle states, flip claims only for
 * weaponisedAfterDecline, escalation only when escalated>0, never "we took
 * down", never time-to-takedown).
 */

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap", variable: "--font-archivo" });
const jbMono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "700"], display: "swap", variable: "--font-jbmono" });

export const dynamic = "force-dynamic";

// Keep in sync with SLIDE_COUNT in scripts/clone-watch-report-export.ts.
// Enforced by apps/web/__tests__/reportCardSlideCount.test.ts — a silent drift
// exports a PDF missing its last slide, and the export's blank-frame check
// cannot see that.
const SLIDE_COUNT = 8;
const TOT = String(SLIDE_COUNT).padStart(2, "0");

type SlideProps = { data: CloneWatchReportCard; page: number };

/** "01 / 07" page marker in the footer rule. */
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

  // Ops appendix (vendor-gap clock / unactioned age / weaponisation cuts /
  // detection lag) renders ONLY in the stacked preview — never in the
  // Puppeteer ?slide=N export path, so the LinkedIn carousel is unchanged.
  const ops = only == null ? await fetchOpsStats() : null;

  return (
    <div className={`${archivo.variable} ${jbMono.variable} rc-root${only ? " rc-solo" : ""}`}>
      <style dangerouslySetInnerHTML={{ __html: reportCardCss }} />
      {slides.map((n) => (
        <Slide key={n} n={n} data={data} />
      ))}
      {ops && <OpsAppendix data={data} ops={ops} />}
    </div>
  );
}

/* ── ops appendix (internal only; below the stacked preview) ─────────────── */

const LAG_SAMPLE_LIMIT = 1000;

interface OpsStats {
  age: {
    n: number;
    median_days: number | null;
    p90_days: number | null;
    oldest_days: number | null;
  } | null;
  /** Median hours scanned_at − urlscan_submitted_at over weaponising
   *  transitions (the flip-catch lag), + sample size. `capped` = the query
   *  hit LAG_SAMPLE_LIMIT, so the median covers the most recent rows only. */
  detectionLag: { n: number; medianHours: number | null; capped: boolean };
  /** created_at of the earliest transition row — "collecting since". */
  collectingSince: string | null;
}

async function fetchOpsStats(): Promise<OpsStats | null> {
  const sb = createServiceClient();
  if (!sb) return null;

  const [ageRes, lagRes, firstRes] = await Promise.all([
    sb.rpc("clone_watch_unactioned_age_stats"),
    sb
      .from("clone_watch_scan_transitions")
      .select("scanned_at, urlscan_submitted_at")
      .eq("new_classification", "likely_phishing")
      // Newest-first so a capped sample measures CURRENT latency, not the
      // system's first weeks. The cap is never silent: `capped` labels the
      // UI and we warn (the fetchMonthByBrand LIMIT-warn precedent).
      .order("scanned_at", { ascending: false })
      .limit(LAG_SAMPLE_LIMIT),
    sb
      .from("clone_watch_scan_transitions")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(1),
  ]);

  const age = Array.isArray(ageRes.data) ? (ageRes.data[0] ?? null) : null;

  const rows = lagRes.data ?? [];
  const capped = rows.length === LAG_SAMPLE_LIMIT;
  if (capped) {
    logger.warn("report-card ops: detection-lag fetch hit LIMIT", {
      limit: LAG_SAMPLE_LIMIT,
    });
  }
  const lags = rows
    .map((r) =>
      r.urlscan_submitted_at && r.scanned_at
        ? (Date.parse(r.scanned_at) - Date.parse(r.urlscan_submitted_at)) / 3_600_000
        : null,
    )
    .filter((h): h is number => h != null && Number.isFinite(h) && h >= 0);

  return {
    age,
    detectionLag: { n: lags.length, medianHours: medianOf(lags), capped },
    collectingSince: firstRes.data?.[0]?.created_at ?? null,
  };
}

function legCell(leg: DurationLeg): string {
  if (leg.n === 0) return "no completed pairs yet";
  if (leg.n < MEDIAN_FLOOR || leg.medianHours == null) {
    return `n=${leg.n} — median withheld (sample < ${MEDIAN_FLOOR})`;
  }
  return `n=${leg.n} · median ${formatMedianHours(leg.medianHours)}`;
}

function OpsAppendix({ data, ops }: { data: CloneWatchReportCard; ops: OpsStats }) {
  const d = data.durations;
  const box: React.CSSProperties = {
    border: "1px solid #333",
    padding: "20px 24px",
    marginBottom: 20,
  };
  const lab: React.CSSProperties = {
    fontFamily: "var(--font-jbmono)",
    fontSize: 12,
    letterSpacing: "0.14em",
    opacity: 0.6,
    marginBottom: 10,
  };
  const line: React.CSSProperties = { margin: "4px 0", fontSize: 15 };
  return (
    <section
      style={{
        maxWidth: 1080,
        margin: "40px auto 80px",
        padding: "0 24px",
        fontFamily: "var(--font-archivo)",
      }}
    >
      <h2 style={{ fontSize: 22, marginBottom: 6 }}>
        Ops appendix — {data.periodLabel} cohort (not exported to LinkedIn)
      </h2>
      <p style={{ fontSize: 13, opacity: 0.65, marginBottom: 24 }}>
        Cohort-windowed on first_seen_at, so these differ (correctly) from the
        rolling 90-day figures on the public /clone-watch panel. Weaponisation
        timestamps are quantised by the 6h recheck + 3h retrieve crons.
      </p>

      <div style={box}>
        <div style={lab}>THE VENDOR-GAP CLOCK</div>
        <p style={line}>Netcraft decline → weaponised: {legCell(d.declineToWeaponise)}</p>
        <p style={line}>Weaponised → we re-filed: {legCell(d.weaponiseToRefile)}</p>
        <p style={line}>Re-filed → witnessed takedown: {legCell(d.refileToTakedown)}</p>
        <p style={line}>First report → witnessed takedown (full loop): {legCell(d.fullLoop)}</p>
        {d.excludedNegativeN > 0 && (
          <p style={{ ...line, opacity: 0.65 }}>
            {d.excludedNegativeN} pair{d.excludedNegativeN === 1 ? "" : "s"} excluded
            (decline re-stamped after weaponisation — last-touch pathology).
          </p>
        )}
        {d.anomalousInversionsN > 0 && (
          <p style={{ ...line, opacity: 0.65 }}>
            {d.anomalousInversionsN} anomalous ordering
            {d.anomalousInversionsN === 1 ? "" : "s"} excluded on other legs —
            unexpected, worth a look.
          </p>
        )}
      </div>

      <div style={box}>
        {/* No flat liveness claims: lifecycle_state is not a liveness probe
            (the F2 still_live_as_of rule) — the predicate only proves the
            LAST scan rendered; the site may have died since. */}
        <div style={lab}>UNACTIONED ATTACK SURFACE — DECLINED, PER LAST SCAN</div>
        {ops.age && ops.age.n > 0 ? (
          <p style={line}>
            {ops.age.n} declined lookalikes whose last scan rendered (liveness
            not re-checked) · median age {ops.age.median_days}d · p90{" "}
            {ops.age.p90_days}d · oldest {ops.age.oldest_days}d
          </p>
        ) : (
          <p style={line}>No declined lookalikes with a rendering last scan.</p>
        )}
      </div>

      <div style={box}>
        <div style={lab}>DETECTION LAG (WEAPONISATION FLIPS CAUGHT)</div>
        <p style={line}>
          {ops.detectionLag.n === 0 || ops.detectionLag.medianHours == null
            ? "No weaponising transitions archived yet"
            : `n=${ops.detectionLag.n}${ops.detectionLag.capped ? ` (most recent ${ops.detectionLag.n} only — sample capped)` : ""} · median ${formatMedianHours(ops.detectionLag.medianHours)} from rescan submit to verdict`}
          {ops.collectingSince
            ? ` — collecting since ${ops.collectingSince.slice(0, 10)} (v230)`
            : " — collecting from v230 deploy"}
          .
        </p>
      </div>

      <div style={box}>
        <div style={lab}>WHO WEAPONISES — REGISTRAR / TLD CUT (COHORT)</div>
        {data.registrarWeaponisation.length === 0 ? (
          <p style={line}>No weaponised clones in this cohort.</p>
        ) : (
          <>
            {data.registrarWeaponisation.slice(0, 6).map((r) => (
              <p style={line} key={r.registrar}>
                {r.registrar}: {r.weaponised} weaponised
                {r.medianDaysToWeaponise != null
                  ? ` · median ${r.medianDaysToWeaponise}d from registration`
                  : ""}
              </p>
            ))}
            <p style={{ ...line, marginTop: 10 }}>
              TLDs:{" "}
              {data.tldWeaponisation
                .slice(0, 6)
                .map((t) => `.${t.tld} (${t.weaponised})`)
                .join(" · ")}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function Slide({ n, data }: { n: number; data: CloneWatchReportCard }) {
  switch (n) {
    case 1: return <SlideHook data={data} page={n} />;
    case 2: return <SlideAuBrands data={data} page={n} />;
    case 3: return <SlideSuperFund data={data} page={n} />;
    case 4: return <SlideRegistrars data={data} page={n} />;
    case 5: return <SlideNames data={data} page={n} />;
    case 6: return <SlideAnatomy data={data} page={n} />;
    case 7: return <SlideActed data={data} page={n} />;
    default: return <SlideClose data={data} page={n} />;
  }
}

/* ── 05 — how the names are built ───────────────────────────────────────── */
/**
 * The two most defensible families in the report, on one slide.
 *
 * Tactic is a property of the domain STRING, which is all the classifier ever
 * sees, so it is publishable as "how the name is built" and never as what the
 * site does. TLD is derived from the string itself — no model, no vendor, 100%
 * coverage.
 *
 * Rows are hard-capped at 5 each so the slide is bounded BY CONSTRUCTION. The
 * 1080x1350 overflow assert in scripts/clone-watch-report-export.ts only fires
 * at export time, which is after the founder has approved the edition.
 */
function SlideNames({ data, page }: SlideProps) {
  const period = data.periodLabel.toUpperCase();
  const tactics = data.targeting.tactics.top.slice(0, 5);
  const tlds = data.targeting.tlds.top.slice(0, 5);
  const tacticMax = tactics[0]?.n ?? 1;
  const tldMax = tlds[0]?.n ?? 1;
  const deliberate = data.targeting.tactics.total;
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">HOW THE NAMES ARE BUILT</span>
        <span className="r">IN AGGREGATE · {period}</span>
      </div>
      <h2 className="h2">The shapes they use</h2>
      <div className="subhead">
        Naming pattern across {deliberate} lookalikes judged deliberate — how the
        domain is constructed, not what any site did.
      </div>
      <div className="rows">
        {tactics.map((t, i) => (
          <div className="row" key={t.key}>
            <div className="name reg-name">{tacticLabel(t.key)}</div>
            <div className="track"><div className={`fill${i === 0 ? " accent" : ""}`} style={{ width: `${((t.n / tacticMax) * 100).toFixed(1)}%` }} /></div>
            <div className={`val${i === 0 ? " accent" : ""}`}>{t.n}</div>
          </div>
        ))}
      </div>
      <div className="know" style={{ marginTop: 28 }}>
        <div className="lab">WHERE THEY REGISTER THEM</div>
        <div className="txt">
          {tlds.map((t, i) => (
            <span key={t.key}>
              {i > 0 ? " · " : ""}
              <b style={{ color: "var(--ink)" }}>.{t.key}</b> {t.n}
            </span>
          ))}
        </div>
      </div>
      <div className="foot rule2 bot">
        <div className="reg">
          {buildClassifierCaveat(data.total, deliberate) ||
            "Naming pattern is read from the domain itself."}
        </div>
        <Pg n={page} />
      </div>
    </section>
  );
}

/* ── 01 — hook (the number) ──────────────────────────────────────────────── */
function SlideHook({ data, page }: SlideProps) {
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
        <Pg n={page} />
      </div>
    </section>
  );
}

/* ── 02 — top AU brands ──────────────────────────────────────────────────── */
function SlideAuBrands({ data, page }: SlideProps) {
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
        <Pg n={page} />
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

/* ── 03 — the month's spotlight, chosen by news value (v271 ladder) ─────────
   Biggest MoM mover → first-time entrant → super fund → global brands, never
   repeating last month's subject. The old category-only rule showed HESTA two
   months running while Apple 42→85 and Google 21→54 went unmentioned. */
function SlideSuperFund({ data, page }: SlideProps) {
  const sp = data.spotlight;
  // Nothing individual qualified → the global-brands slide holds this slot.
  if (sp.kind === "globals" || !sp.brand) return <SlideGlobal data={data} page={page} />;
  const period = data.periodLabel.toUpperCase();
  const name = prettyBrand(sp.brand);
  const isFund = sp.kind === "super_fund";
  const eyebrow =
    sp.kind === "mover" ? "THE BIGGEST MOVER"
    : sp.kind === "new_entrant" ? "NEW ON THE MAP"
    : "THE SUPER-FUND ANGLE";
  const rightTag =
    sp.kind === "mover" ? `MOVER · ${period}`
    : sp.kind === "new_entrant" ? `NEW ENTRANT · ${period}`
    : `SUPER FUND · ${period}`;
  const heading =
    sp.kind === "mover" ? (
      <>{name} lookalikes<br />more than {sp.priorClones && sp.clones >= sp.priorClones * 2 ? "doubled" : "jumped"}.</>
    ) : sp.kind === "new_entrant" ? (
      <>{name} appeared for<br />the first time.</>
    ) : (
      <>A super fund was {auRankPhrase(sp.auRank)}<br />Australian brand.</>
    );
  const lead =
    sp.kind === "mover" ? (
      <>Up from <b>{sp.priorClones} last month</b> to {sp.clones} — the sharpest single-brand rise we recorded. A spike like this usually means one actor registering in bulk.</>
    ) : sp.kind === "new_entrant" ? (
      <>Not on last month&rsquo;s map at all. A brand&rsquo;s first appearance is the moment its customers are least primed to expect a fake.</>
    ) : (
      <>Retirement savings are a front-line target now — <b>not just your bank login.</b> One super-fund password can open a lifetime of savings.</>
    );
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">{eyebrow}</span>
        <span className="r">{rightTag}</span>
      </div>
      <h2 className={`h2b${isFund ? " sf" : ""}`}>{heading}</h2>
      <div className="spotstat">
        <span className="spotnum">{sp.clones}</span>
        <span className="spotname">{name}<span>lookalike domains · {data.periodLabel}</span></span>
      </div>
      <p className="spotlead">{lead}</p>
      <div className="note">Lookalike domains impersonating {name}; {name} is the targeted party, not the source. Detected, not all confirmed malicious.</div>
      <div className="foot rule2 bot">
        <div className="reg">Ranked among Australian (.au) brands by lookalike domains detected in {data.periodLabel}.</div>
        <Pg n={page} />
      </div>
    </section>
  );
}

/* ── 05 — why a lookalike works / what it means ──────────────────────────── */
function SlideAnatomy({ data, page }: SlideProps) {
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
        <Pg n={page} />
      </div>
    </section>
  );
}

/* ── global brands (only rendered as the no-super-fund fallback for slot 3) ─ */
function SlideGlobal({ data, page }: SlideProps) {
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
        <Pg n={page} />
      </div>
    </section>
  );
}

/* ── 04 — registrar accountability (aggregate only) ──────────────────────── */
function SlideRegistrars({ data, page }: SlideProps) {
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
        <Pg n={page} />
      </div>
    </section>
  );
}

/* ── 06 — what we did (reported / phishing / parked + vendor outcomes) ───── */
function SlideActed({ data, page }: SlideProps) {
  const period = data.periodLabel.toUpperCase();
  // Vendor-outcome line (F5): witnessed per-URL gradings for THIS month's
  // cohort, from the daily reconciler. Empty on all-zero months (pre-lifecycle
  // history, quiet months) — the block hides and the slide renders exactly as
  // the June 2026 edition did.
  const outcomes = buildOutcomesLine(data.kpis);
  return (
    <section className="slide">
      <div className="hdr">
        <span className="l">WHAT WE DID</span>
        <span className="r">ASK ARTHUR · {period}</span>
      </div>
      <h2 className="h2b">Detected — then acted.</h2>
      {/* ONE action number, on its own. The old layout sat it beside two
          classification counts, so a reader tried to reconcile 792 / 40 / 6
          against a 1000 headline and could not — three numbers, two different
          axes, no denominator. */}
      <div className="kpis" style={{ marginTop: 36 }}>
        <div className="kpi accent">
          <div className="n">{data.kpis.reportedToNetcraft}</div>
          <div className="l">
            of {data.total} reported to Netcraft for takedown review
          </div>
        </div>
      </div>
      {/* The classification axis, COMPLETE — the buckets partition the cohort and
          sum to the headline, so the two small newsworthy buckets finally carry a
          denominator and "no verdict" stops being invisible.

          Two wording rules learned the hard way:
          (1) `unresolved` renders only when non-zero. It has never been written —
              0 rows across every source, all time — because classifyScan only
              runs on a non-null render. Printing "0 didn't resolve" under a
              header reading ALL {total} tells the reader every scan resolved,
              which is the opposite of true for the bucket below it.
          (2) The last bucket is NOT "not yet scanned". The submit worklist gates
              on `first_seen_at >= now() - 14 days`, so once a month's cohort ages
              past that window its unclassified rows are never scanned — for the
              June cohort that was 320 of 804, every one of them permanently
              unscannable. "Not yet" is a promise the pipeline cannot keep. */}
      <div className="know" style={{ marginTop: 28 }}>
        <div className="lab">WHAT THE SCANS FOUND — ALL {data.total}</div>
        <div className="txt">
          {data.kpis.likelyPhishing} serving likely phishing ·{" "}
          {data.kpis.parkedForSale} parked / for sale ·{" "}
          {data.kpis.neutral} resolved, nothing malicious found ·{" "}
          {data.kpis.unresolved > 0 && (
            <>{data.kpis.unresolved} scanned but didn&apos;t render · </>
          )}
          {data.kpis.unclassified} with no verdict on record.
        </div>
      </div>
      {outcomes && (
        <div className="know" style={{ marginTop: 24 }}>
          <div className="lab">WHAT HAPPENED NEXT</div>
          <div className="txt">Of this month&apos;s detections: {outcomes}.</div>
        </div>
      )}
      <div className="know" style={{ marginTop: outcomes ? 24 : 28 }}>
        <div className="lab">HOW WE KNOW</div>
        <div className="txt">We sweep newly-registered domains against ~50 major Australian brands daily, enrich with WHOIS + certificate data, and review by hand — each with a public evidence page on urlscan.io.</div>
      </div>
      <div className="note">
        {outcomes ? (
          <>Reported to Netcraft is a takedown <b>request</b>. Outcome counts are the current per-URL status of this month&apos;s detections, observed from the vendor&apos;s own gradings.</>
        ) : (
          <>Reported to Netcraft for review is a takedown <b>request</b>, not a confirmed takedown.</>
        )}
      </div>
      <div className="foot rule2 bot">
        <div className="reg">Full URL-level evidence list available to affected brands on request.</div>
        <Pg n={page} />
      </div>
    </section>
  );
}

/* ── 07 — civic CTA + method link ────────────────────────────────────────── */
function SlideClose({ data, page }: SlideProps) {
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
          <Pg n={page} />
        </div>
      </div>
    </section>
  );
}

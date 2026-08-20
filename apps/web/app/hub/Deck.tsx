"use client";

// The /hub deck: five chapters, horizontal scroll-snap on desktop, an ordinary
// vertical page on mobile. Presentation only — every number and link it shows
// is resolved server-side in page.tsx.
//
// Export mode: `?slide=N` (1-indexed) pins a single chapter and hides the
// chrome so scripts/hub-carousel-export.ts can screenshot it at 1080x1350.
// Read from window.location.search in an effect rather than useSearchParams(),
// which would opt the whole route out of ISR.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/track";
import type { Chapter } from "./chapters";
import styles from "./hub.module.css";

const ARROW = "↗"; // ↗ outbound
const LEFT = "←";
const RIGHT = "→";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function Deck({ chapters }: { chapters: Chapter[] }) {
  const [current, setCurrent] = useState(0);
  const [exportSlide, setExportSlide] = useState<number | null>(null);
  const deckRef = useRef<HTMLElement | null>(null);
  const slideRefs = useRef<(HTMLElement | null)[]>([]);
  /** Chapters already reported, so a scroll back and forth does not double-count. */
  const seen = useRef<Set<string>>(new Set());
  /** True once the initial deep-link navigation has been applied. Until then the
   *  hash-writer effect must not run, or it overwrites the incoming hash. */
  const didInit = useRef(false);
  /** The hash the visitor ARRIVED with, captured during render — before any
   *  effect (including this component's own hash-writer) can replace it.
   *  Empty string on the server and for a plain /hub visit. */
  const initialHashRef = useRef<string | null>(null);
  if (initialHashRef.current === null) {
    initialHashRef.current =
      typeof window === "undefined" ? "" : window.location.hash.slice(1);
  }
  const initialHash = initialHashRef.current;

  /* ---- Export mode ---------------------------------------------------- */
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("slide");
    if (!raw) return;
    const n = Number.parseInt(raw, 10);
    if (Number.isInteger(n) && n >= 1 && n <= chapters.length) {
      setExportSlide(n - 1);
      setCurrent(n - 1);
    }
  }, [chapters.length]);

  const isExport = exportSlide !== null;
  const visible = useMemo(
    () => (isExport ? [chapters[exportSlide]] : chapters),
    [chapters, exportSlide, isExport],
  );

  /* ---- Analytics ------------------------------------------------------
     `pageview` is the only client-safe event that fits (see the allowlist in
     app/api/events/route.ts — link_click is deliberately server-only). Every
     event carries `chapter`, so a visit count is
     `... where event_props->>'chapter' = 'now'`, NOT a raw /hub pageview
     count, which would be inflated up to 5x by chapter progression.        */
  const report = useCallback(
    (index: number) => {
      const ch = chapters[index];
      if (!ch || seen.current.has(ch.id)) return;
      seen.current.add(ch.id);
      track("pageview", { content_type: "hub", chapter: ch.id });
    },
    [chapters],
  );

  /* ---- Track which slide is on screen --------------------------------- */
  useEffect(() => {
    if (isExport) {
      report(exportSlide);
      return;
    }
    const nodes = slideRefs.current.filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.55) {
            const i = nodes.indexOf(e.target as HTMLElement);
            if (i > -1) {
              setCurrent(i);
              report(i);
            }
          }
        }
      },
      { threshold: [0.55] },
    );
    for (const n of nodes) observer.observe(n);
    return () => observer.disconnect();
  }, [visible.length, isExport, exportSlide, report]);

  /* ---- Deep-linkable: each chapter owns a hash -------------------------
     Gated on `didInit`. This effect is declared BEFORE the deep-link effect
     below, so on mount it runs first — and with `current` still 0 it used to
     rewrite an incoming /hub#elsewhere to /hub#now via replaceState. The
     deep-link effect then read the hash it had just clobbered, found "now",
     and stayed on chapter 01. The deck was overwriting its own deep link
     before it could act on it. */
  useEffect(() => {
    if (isExport || !didInit.current) return;
    const id = chapters[current]?.id;
    if (id && window.location.hash.slice(1) !== id) {
      window.history.replaceState(null, "", `#${id}`);
    }
  }, [current, chapters, isExport]);

  const goTo = useCallback(
    (i: number, behavior: ScrollBehavior = "smooth") => {
      const clamped = Math.max(0, Math.min(visible.length - 1, i));
      const node = slideRefs.current[clamped];
      if (!node) return;
      node.scrollIntoView({ behavior, inline: "start", block: "start" });
      node.focus?.({ preventScroll: true });
      setCurrent(clamped);
    },
    [visible.length],
  );

  /* ---- Open on the chapter named in the URL, e.g. /hub#clone-watch -----
     Reads `initialHash`, captured during the first RENDER, not
     window.location at effect time — by the time effects run the hash-writer
     above may already have replaced it.

     Deferred two frames so the slides have been laid out (scrollIntoView
     against an unlaid-out flex row lands short), and jumped with
     behavior:"auto" rather than "smooth": a deep link should arrive already
     there, not animate past four chapters on open. */
  useEffect(() => {
    if (isExport) return;
    const i = chapters.findIndex((c) => c.id === initialHash);
    if (i < 0) {
      didInit.current = true;
      report(0);
      return;
    }
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        goTo(i, "auto");
        didInit.current = true;
      }),
    );
    return () => cancelAnimationFrame(raf);
    // Runs once on mount; goTo/report are stable and re-running would fight
    // the user's own scrolling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- Keyboard: arrows, Home, End ------------------------------------ */
  useEffect(() => {
    if (isExport) return;
    function onKey(e: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement | null)?.tagName ?? "";
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(current + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(current - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        goTo(0);
      } else if (e.key === "End") {
        e.preventDefault();
        goTo(visible.length - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, goTo, visible.length, isExport]);

  const chapter = chapters[current];

  return (
    <div className={styles.shell} data-export={isExport ? "true" : undefined}>
      <a className={styles.skip} href="#deck">
        Skip to content
      </a>

      <header className={styles.chrome}>
        <a className={styles.wordmark} href="https://askarthur.au/">
          Ask Arthur
        </a>
        <div className={styles.progress} aria-hidden="true">
          <div className={styles.count}>
            {pad(current + 1)} / {pad(chapters.length)}
            <span className={styles.sep}>·</span>
            {chapter?.nav}
          </div>
          <div className={styles.ticks}>
            {chapters.map((c, i) => (
              <span key={c.id} className={styles.tick} data-on={String(i === current)} />
            ))}
          </div>
        </div>
      </header>

      <p className={styles.live} aria-live="polite">
        {`Chapter ${current + 1} of ${chapters.length}: ${chapter?.nav ?? ""}`}
      </p>

      <main className={styles.deck} id="deck" tabIndex={-1} ref={deckRef}>
        {visible.map((ch, i) => (
          <section
            key={ch.id}
            className={styles.slide}
            id={ch.id}
            tabIndex={-1}
            aria-label={ch.nav}
            // Stable selector for scripts/hub-carousel-export.ts. CSS-module
            // class names are hashed at build time, so the exporter cannot
            // target `.slide` — do not remove.
            data-hub-slide=""
            ref={(n) => {
              slideRefs.current[i] = n;
            }}
          >
            <div className={styles.inner}>
              <ChapterBody chapter={ch} />
            </div>
          </section>
        ))}
      </main>

      {!isExport && (
        <nav className={styles.controls} aria-label="Chapter navigation">
          <button
            type="button"
            className={styles.ctrl}
            onClick={() => goTo(current - 1)}
            disabled={current === 0}
            aria-label="Previous chapter"
          >
            {LEFT}
          </button>
          <button
            type="button"
            className={styles.ctrl}
            onClick={() => goTo(current + 1)}
            disabled={current === chapters.length - 1}
            aria-label="Next chapter"
          >
            {RIGHT}
          </button>
        </nav>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function CtaLink({ cta }: { cta?: Cta }) {
  if (!cta) return null;
  return (
    <a className={styles.textlink} href={cta.href}>
      {cta.label}
      <span className={styles.arrow} aria-hidden="true">
        {ARROW}
      </span>
    </a>
  );
}
type Cta = NonNullable<Chapter["cta"]>;

function Head({ chapter }: { chapter: Chapter }) {
  return (
    <>
      {chapter.eyebrow && <p className={styles.eyebrow}>{chapter.eyebrow}</p>}
      {chapter.kicker && <p className={styles.kicker}>{chapter.kicker}</p>}
      <h2 className={styles.h2}>{chapter.title}</h2>
      {chapter.lede && <p className={styles.lede}>{chapter.lede}</p>}
    </>
  );
}

function ChapterBody({ chapter }: { chapter: Chapter }) {
  switch (chapter.kind) {
    case "hero":
      return (
        <>
          <p className={styles.eyebrow}>{chapter.eyebrow}</p>
          <h1 className={styles.h1}>
            {chapter.title.split("\n").map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </h1>
          {chapter.lede && <p className={styles.lede}>{chapter.lede}</p>}
          <CtaLink cta={chapter.cta} />
          <p className={styles.colophon}>
            {chapter.meta.map((m, i) => (
              <span key={m}>
                {i > 0 && <br />}
                {m}
              </span>
            ))}
          </p>
        </>
      );

    case "cards":
      return (
        <>
          <Head chapter={chapter} />
          <CtaLink cta={chapter.cta} />
          <div className={styles.grid}>
            {chapter.items.map((it, i) => (
              <a key={it.title} className={styles.card} href={it.href}>
                <span className={styles.art} />
                <span className={styles.cardMeta}>
                  <span className={styles.idx}>{pad(i + 1)}</span>
                  <span className={styles.label}>
                    <b>{it.title}</b>
                    <span>{it.meta}</span>
                  </span>
                  <span className={styles.go} aria-hidden="true">
                    {ARROW}
                  </span>
                </span>
              </a>
            ))}
          </div>
        </>
      );

    case "rows":
      return (
        <>
          <Head chapter={chapter} />
          <CtaLink cta={chapter.cta} />
          <div className={styles.rows}>
            {chapter.items.map((it, i) => (
              <a key={it.href} className={styles.row} href={it.href}>
                <span className={styles.idx}>{pad(i + 1)}</span>
                <span className={styles.rowTitle}>{it.title}</span>
                <span className={styles.time}>{it.meta}</span>
              </a>
            ))}
          </div>
        </>
      );

    case "panel":
      return (
        <>
          <Head chapter={chapter} />
          <div className={styles.panel}>
            {/* No stats block at all when the RPC failed — a zero here would
                read as "we found nothing", which is a lie, not a gap. */}
            {chapter.stats && (
              <>
                <div className={styles.stats}>
                  {chapter.stats.map((s) => (
                    <div
                      key={s.k}
                      className={s.accent ? `${styles.stat} ${styles.statAccent}` : styles.stat}
                    >
                      <div className={styles.statN}>{s.n}</div>
                      <div className={styles.statK}>{s.k}</div>
                    </div>
                  ))}
                </div>
                {chapter.statsWindow && (
                  <p className={styles.statsWindow}>{chapter.statsWindow}</p>
                )}
              </>
            )}
            <p className={styles.panelNote}>{chapter.note}</p>
            {chapter.featured && (
              <a className={styles.featured} href={chapter.featured.href}>
                <span className={styles.featuredBody}>
                  <span className={styles.kicker}>{chapter.featured.kicker}</span>
                  <b>{chapter.featured.title}</b>
                  <span>{chapter.featured.meta}</span>
                </span>
                <span className={styles.go} aria-hidden="true">
                  {ARROW}
                </span>
              </a>
            )}
          </div>
          <p className={styles.panelCta}>
            <CtaLink cta={chapter.cta} />
          </p>
        </>
      );

    case "links":
      return (
        <>
          <Head chapter={chapter} />
          <ul className={styles.links}>
            {chapter.items.map((it, i) => (
              <li key={it.name}>
                <a href={it.href}>
                  <span className={styles.linkIdx}>{pad(i + 1)}</span>
                  <span className={styles.name}>{it.name}</span>
                  <span className={styles.desc}>{it.desc}</span>
                  <span className={styles.linkGo} aria-hidden="true">
                    {ARROW}
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className={styles.colophon}>{chapter.colophon}</p>
        </>
      );
  }
}

/**
 * Arthur's Take — production smoke test. Read-only, no spend.
 *
 *   pnpm --filter @askarthur/web tsx scripts/_smoke-arthurs-take.ts [origin]
 *
 * Run after every deploy that touches the feed, the take pages or the
 * (marketing) layout.
 *
 * WHY THIS EXISTS, AND WHY IT ASSERTS THE WAY IT DOES.
 *
 * Three checks gave the wrong answer in one session, each because it tested a
 * proxy instead of the thing:
 *
 *   1. STATUS CODES LIE HERE. These routes are force-dynamic and stream, so a
 *      page that throws mid-render still returns 200. `/scam-feed/42353`
 *      returned 200 with an empty body for every bare-id link.
 *   2. MARKUP FRAGMENTS LIE. A check for the literal string `>Scanner<`
 *      reported "no navigation" on a page that had a full nav bar, because the
 *      markup nests differently than assumed.
 *   3. A GREEN SUITE LIES ABOUT PRODUCTION. Typecheck, lint and 2,300 unit
 *      tests were green while /api/feed published body_md and every detail
 *      page rendered "Report not found".
 *
 * So every assertion below is made against TEXT EXTRACTED FROM THE RENDERED
 * PAGE, never a status code and never a raw HTML substring. Each check names
 * the bug it would have caught, so a future reader can tell whether it still
 * earns its place.
 */
import "./_load-env-config";

const ORIGIN = process.argv[2] ?? "https://askarthur.au";

interface Check {
  name: string;
  /** The bug this would have caught. Keeps dead checks visible. */
  guards: string;
  run: () => Promise<string | null>; // null = pass, string = failure reason
}

/** Strip tags and scripts so assertions see what a READER sees. */
function visibleText(html: string): string {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ");
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(path: string): Promise<string> {
  try {
    const res = await fetch(`${ORIGIN}${path}`, {
      headers: { "user-agent": "askarthur-smoke/1.0" },
    });
    return visibleText(await res.text());
  } catch {
    return "";
  }
}

/**
 * Never throws. A smoke test that dies on a bad response reports less than one
 * that says "the API returned HTML" — the first version crashed with
 * "Unexpected token '<'" instead of failing a named check.
 */
async function fetchJson(path: string): Promise<unknown> {
  try {
    const res = await fetch(`${ORIGIN}${path}`);
    const body = await res.text();
    try {
      return JSON.parse(body);
    } catch {
      return { __error: `not JSON (HTTP ${res.status}): ${body.slice(0, 60)}` };
    }
  } catch (e) {
    return { __error: e instanceof Error ? e.message : String(e) };
  }
}

function jsonError(v: unknown): string | null {
  return v && typeof v === "object" && "__error" in v
    ? String((v as { __error: unknown }).__error)
    : null;
}

/** Pull one page-worthy take id straight from the live feed API. */
async function findLiveTakeSlug(): Promise<string | null> {
  const raw = await fetchJson("/api/feed?limit=20");
  if (jsonError(raw)) return null;
  const data = raw as {
    items?: {
      id: number;
      title: string;
      reddit_post_intel?: {
        take_status?: string | null;
        take_tells?: string[] | null;
        confidence?: number | null;
      } | null;
    }[];
  };
  const hit = (data.items ?? []).find(
    (i) =>
      i.reddit_post_intel?.take_status === "ready" &&
      (i.reddit_post_intel?.take_tells?.length ?? 0) >= 2 &&
      (i.reddit_post_intel?.confidence ?? 0) >= 0.7,
  );
  if (!hit) return null;
  const words = hit.title
    .toLowerCase()
    .replace(/\[[a-z]{2,3}\]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 6)
    .join("-");
  return words ? `${hit.id}-${words}` : String(hit.id);
}

const MARKETING_PAGES = [
  "/scam-feed",
  "/scam-map",
  "/spf-compliance",
] as const;

async function build(): Promise<Check[]> {
  const slug = await findLiveTakeSlug();

  const checks: Check[] = [
    {
      name: "feed API hides analysis-only columns",
      guards:
        "/api/feed published body_md to every caller — the migration closed the PostgREST door but the route uses the service client, which bypasses column grants",
      run: async () => {
        const raw = await fetchJson("/api/feed?limit=1");
        const err = jsonError(raw);
        if (err) return `feed API unusable: ${err}`;
        const d = raw as { items?: Record<string, unknown>[] };
        const item = d.items?.[0];
        if (!item) return "feed API returned no items";
        for (const forbidden of ["body_md", "embedding"]) {
          if (forbidden in item) return `${forbidden} is in the payload`;
        }
        return null;
      },
    },
    {
      name: "feed still serves items",
      guards: "over-trimming the column list would blank the feed silently",
      run: async () => {
        const raw = await fetchJson("/api/feed?limit=5");
        const err = jsonError(raw);
        if (err) return `feed API unusable: ${err}`;
        const d = raw as { items?: unknown[] };
        return (d.items?.length ?? 0) > 0 ? null : "feed API returned 0 items";
      },
    },
    ...MARKETING_PAGES.map((path) => ({
      name: `${path} renders the site shell`,
      guards:
        "the (marketing) group had no layout, so /spf-compliance and /scam-feed/[id] both shipped with no navigation and no footer",
      run: async () => {
        const text = await fetchText(path);
        const missing = ["Scanner", "Persona Check", "Feed", "Blog", "About"]
          .filter((link) => !text.includes(link));
        return missing.length === 0
          ? null
          : `missing nav links: ${missing.join(", ")}`;
      },
    })),
  ];

  if (!slug) {
    checks.push({
      name: "a page-worthy take exists on the first feed page",
      guards:
        "takes only cover posts classified in the same run, so the top of the feed can silently have none",
      run: async () => "no page-worthy take in the newest 20 feed items",
    });
    return checks;
  }

  checks.push(
    {
      name: `/scam-feed/${slug} renders the take`,
      guards:
        "an ambiguous PostgREST embed made the loader return null, so EVERY take page rendered a clean 'Report not found' at HTTP 200",
      run: async () => {
        const text = await fetchText(`/scam-feed/${slug}`);
        if (text.includes("not found")) return "rendered 'not found'";
        return text.includes("What Arthur sees in this pattern")
          ? null
          : "take heading absent from the rendered page";
      },
    },
    {
      name: "the bare-id form of the same URL also renders",
      guards:
        "redirect() after generateMetadata flushed on a streamed route produced a 200 with an EMPTY BODY for every shared bare-id link",
      run: async () => {
        const id = slug.split("-")[0];
        const text = await fetchText(`/scam-feed/${id}`);
        if (text.length < 200) return `body is nearly empty (${text.length} chars)`;
        return text.includes("What Arthur sees in this pattern")
          ? null
          : "take heading absent on the bare-id URL";
      },
    },
    {
      name: "the take page leads with our recap, not the raw excerpt",
      guards:
        "the page rendered 500 raw characters of the poster's text, cut mid-word, above our analysis",
      run: async () => {
        const text = await fetchText(`/scam-feed/${slug}`);
        return text.includes("What happened")
          ? null
          : "'What happened' recap missing";
      },
    },
    {
      name: "attribution to the original post is present",
      guards:
        "reddit-intel-reddit-tos.md §4 requires a permalink on every derived view",
      run: async () => {
        const text = await fetchText(`/scam-feed/${slug}`);
        return text.includes("Read the original report on Reddit")
          ? null
          : "no link back to the source post";
      },
    },
    {
      name: "a non-existent take is not found",
      guards:
        "the page-worthy gate must actually gate — a thin or suppressed take must not get a URL",
      run: async () => {
        const text = await fetchText("/scam-feed/99999999");
        return text.toLowerCase().includes("not found")
          ? null
          : "bogus id did not render 'not found'";
      },
    },
  );

  return checks;
}

async function main() {
  console.log(`\nArthur's Take — smoke test against ${ORIGIN}\n`);
  const checks = await build();

  let failed = 0;
  for (const check of checks) {
    let reason: string | null;
    try {
      reason = await check.run();
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
    if (reason) {
      failed += 1;
      console.log(`  FAIL  ${check.name}`);
      console.log(`        ${reason}`);
      console.log(`        guards: ${check.guards}`);
    } else {
      console.log(`  ok    ${check.name}`);
    }
  }

  console.log(
    `\n${checks.length - failed}/${checks.length} passed${failed ? " — SMOKE TEST FAILED" : ""}\n`,
  );
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

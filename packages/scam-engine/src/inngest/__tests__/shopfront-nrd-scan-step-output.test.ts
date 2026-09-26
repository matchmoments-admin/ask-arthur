// #1228 — the NRD ingest must never pass the domain list between steps.
//
// Inngest caps step output at 4 MB per step AND across all steps of a run.
// whoisds' free file is truncated at 70,000 lines (~1.4 MB as a JSON array);
// the full daily feed is ~330k (~6.6 MB). The single download-parse-match
// step returns scanNrdZip()'s result, so these tests pin (a) that result stays
// small at full-feed volume and (b) scanNrdZip finds exactly what the old
// parse-then-match path found.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  canonicaliseCandidateUrl,
  lexicalMatch,
  urlHash,
} from "@askarthur/shopfront-glue";
import { AU_BRAND_WATCHLIST } from "@askarthur/shopfront-glue/au-brand-watchlist";
import { parseNrdZip, scanNrdZip } from "../shopfront-nrd-daily-ingest";

const FULL_FEED_LINES = 350_000;
const STEP_OUTPUT_BUDGET_BYTES = 256 * 1024;
const INNGEST_STEP_OUTPUT_LIMIT_BYTES = 4 * 1024 * 1024;

// Matching cost scales with the watchlist (~0.2 ms/domain on the full list,
// ~78 s at 350k), while the output size scales with hits. The size test only
// needs realistic hits, so the fixture draws its lookalikes from — and
// matches against — a small slice. Equivalence uses the full list.
const SIZE_TEST_WATCHLIST = AU_BRAND_WATCHLIST.slice(0, 8);

// Deterministic PRNG so the fixture (and so the hit set) is stable.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TLDS = ["com", "xyz", "cn", "shop", "online", "top", "net", "org", "au"];
const LURES = ["login", "deals", "secure", "au", "sale", "verify", "help"];

// Mostly noise, with ~1 in 3,000 lines a brand lookalike — about the real
// whoisds hit rate (~30 hits per 70k), scaled to the full feed.
function fixtureLines(
  n: number,
  seed: number,
  brands = AU_BRAND_WATCHLIST,
): string[] {
  const rand = mulberry32(seed);
  const alpha = "abcdefghijklmnopqrstuvwxyz0123456789";
  const lines: string[] = ["# newly registered domains fixture", ""];
  for (let i = 0; i < n; i++) {
    const tld = TLDS[Math.floor(rand() * TLDS.length)];
    if (rand() < 1 / 3000) {
      const b = brands[Math.floor(rand() * brands.length)];
      const token = b!.brand.toLowerCase().replace(/[^a-z0-9]/g, "");
      const lure = LURES[Math.floor(rand() * LURES.length)];
      lines.push(`${token}-${lure}.${tld}`);
      continue;
    }
    let label = "";
    const len = 8 + Math.floor(rand() * 10);
    for (let j = 0; j < len; j++)
      label += alpha[Math.floor(rand() * alpha.length)];
    // Uppercase + CRLF + padding exercise the line rules.
    lines.push(
      i % 997 === 0 ? `  ${label.toUpperCase()}.${tld}  ` : `${label}.${tld}`,
    );
  }
  return lines;
}

async function zipOf(lines: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("domain-names.txt", lines.join("\r\n"));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// The pre-#1228 path, written independently of the module: materialise the
// list, then lexical-match each domain.
async function oldPathHits(zipBuffer: Uint8Array) {
  const domains = await parseNrdZip(zipBuffer);
  const hits = [];
  for (const domain of domains) {
    const r = lexicalMatch(domain, AU_BRAND_WATCHLIST);
    if (!r) continue;
    const candidate_url = canonicaliseCandidateUrl(domain);
    hits.push({
      candidate_domain: domain,
      candidate_url,
      url_hash: await urlHash(candidate_url),
      brand: r.brand,
      legitimate_domain: r.legitimate_domain,
      score: r.score,
      signal_type: r.signal_type,
      evidence: r.evidence,
    });
  }
  return { domains, hits };
}

describe("scanNrdZip — step output at full-feed volume (#1228)", () => {
  it("returns a payload under 256 KB for a 350k-line feed, where the domain list itself would breach Inngest's 4 MB limit", async () => {
    const buf = await zipOf(
      fixtureLines(FULL_FEED_LINES, 1228, SIZE_TEST_WATCHLIST),
    );
    const result = await scanNrdZip(buf, SIZE_TEST_WATCHLIST);

    expect(result.domains_scanned).toBe(FULL_FEED_LINES);
    expect(result.hits.length).toBeGreaterThan(0);

    // What the step returns — Inngest JSON-serialises it.
    const stepOutputBytes = Buffer.byteLength(JSON.stringify(result));
    expect(stepOutputBytes).toBeLessThan(STEP_OUTPUT_BUDGET_BYTES);

    // Fixture realism: the OLD step-1 return (the list) must be over the
    // limit, or this test would pass against the old shape too.
    const oldStepOutputBytes = Buffer.byteLength(
      JSON.stringify(await parseNrdZip(buf)),
    );
    expect(oldStepOutputBytes).toBeGreaterThan(INNGEST_STEP_OUTPUT_LIMIT_BYTES);
  }, 120_000);
});

describe("scanNrdZip — equivalence with the old parse-then-match path", () => {
  it("finds exactly the old path's hits, in order, and counts every domain", async () => {
    const buf = await zipOf(fixtureLines(20_000, 42));
    const [scan, old] = await Promise.all([
      scanNrdZip(buf, AU_BRAND_WATCHLIST),
      oldPathHits(buf),
    ]);
    expect(old.hits.length).toBeGreaterThan(0);
    expect(scan.domains_scanned).toBe(old.domains.length);
    expect(scan.hits).toEqual(old.hits);
  }, 60_000);

  it("skips blank and # comment lines and lower-cases/trims the rest", async () => {
    const buf = await zipOf([
      "# header",
      "",
      "  BUNNINGS-DEALS.SHOP  ",
      "plain-noise-zzq.xyz",
    ]);
    const result = await scanNrdZip(buf, AU_BRAND_WATCHLIST);
    expect(result.domains_scanned).toBe(2);
    expect(result.hits.map((h) => h.candidate_domain)).toEqual([
      "bunnings-deals.shop",
    ]);
  });
});

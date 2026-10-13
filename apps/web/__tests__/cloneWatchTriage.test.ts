import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DECIDED_STATUSES,
  MACHINE_STATUSES,
  TRIAGE_SOURCES,
  TRIAGE_STATUSES,
  TRIAGE_WRITERS,
  canWriteTriage,
  sourceAfterWrite,
  verdictOrigin,
  type TriageWriterId,
} from "@/lib/clone-watch/triage";
import { suggestTriageTransition } from "@/lib/clone-watch/urlscan-classify";

// The triage_status spec (#1301) against the code that writes it. The spec is
// only worth reading if it cannot drift, so every list here is checked
// against the SQL constraint or writer body it describes.
//
// Go-red record (2026-10-13, each change made → the named test failed →
// reverted):
//   - the whole file against origin/main (no triage.ts, no v346)
//        → every test FAILED (import unresolved)
//   - MACHINE_STATUSES gained "fp"
//        → "MACHINE_STATUSES is the v346 CHECK" FAILED
//   - TRIAGE_WRITERS.persist_urlscan.from gained "fp"
//        → "no machine writer moves a row out of a human's verdict …" FAILED
//   - sourceAfterWrite: dropped the tp_confirmed → tp_actioned exception
//        → "the Netcraft writer keeps a human origin only for tp_confirmed → tp_actioned" FAILED
//   - auto-park.ts: `triage_source: "machine"` removed from its UPDATE
//        → "auto-park writes what the spec says" FAILED
//   - a new TS write of triage_status in an unlisted file
//        → "every writer of triage_status is in the spec" FAILED

const repo = new URL("../../../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(repo, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const migrationFiles = () =>
  readdirSync(join(repo, "supabase"))
    .filter((f) => /^migration-v\d+.*\.sql$/.test(f))
    .sort(
      (a, b) => Number(a.match(/v(\d+)/)![1]) - Number(b.match(/v(\d+)/)![1]),
    );
const quoted = (s: string) =>
  [...s.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();

describe("the spec matches the database", () => {
  it("TRIAGE_STATUSES is the v143 CHECK and every SQL writer's validation list", () => {
    const check = read(
      "supabase/migration-v143-shopfront-clone-watch-outreach.sql",
    ).match(/CHECK \(triage_status IN \(([^)]*)\)\)/);
    expect(quoted(check![1])).toEqual([...TRIAGE_STATUSES].sort());
    for (const file of [
      "supabase/migration-v335-clone-watch-readiness.sql", // set_clone_alert_triage
      "supabase/migration-v338-merge-submission-stamps-triage-source.sql",
    ]) {
      const list = read(file).match(/NOT IN \(('pending'[^)]*)\)/);
      expect(quoted(list![1]), file).toEqual([...TRIAGE_STATUSES].sort());
    }
  });

  it("TRIAGE_SOURCES is the v335 CHECK", () => {
    const check = read(
      "supabase/migration-v335-clone-watch-readiness.sql",
    ).match(/triage_source IN \(([^)]*)\)/);
    expect(quoted(check![1])).toEqual([...TRIAGE_SOURCES].sort());
  });

  it("MACHINE_STATUSES is the v346 CHECK", () => {
    const check = read(
      "supabase/migration-v346-persist-urlscan-stamps-triage-source.sql",
    ).match(
      /triage_source IS DISTINCT FROM 'machine'\s+OR triage_status IN \(([^)]*)\)/,
    );
    expect(quoted(check![1])).toEqual([...MACHINE_STATUSES].sort());
  });

  it("every SQL function that assigns triage_status is a spec writer", () => {
    // Newest definition per function: a later CREATE OR REPLACE wins.
    const newest = new Map<string, string>();
    for (const f of migrationFiles()) {
      const src = read(join("supabase", f));
      for (const m of src.matchAll(
        /CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)\([\s\S]*?\$(\w*)\$([\s\S]*?)\$\2\$/g,
      )) {
        newest.set(m[1], m[3]);
      }
    }
    const writers = [...newest.entries()]
      .filter(([, body]) =>
        /(^|\bSET|,)\s*triage_status\s*=(?!=)/m.test(stripSqlComments(body)),
      )
      .map(([name]) => name)
      .sort();
    expect(writers).toEqual([
      "merge_clone_alert_submission",
      "persist_clone_alert_urlscan",
      "set_clone_alert_triage",
    ]);
  });
});

function stripSqlComments(sql: string): string {
  return sql.replace(/--.*$/gm, "");
}

describe("the spec matches the TS writers", () => {
  it("every writer of triage_status is in the spec", () => {
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(join(repo, dir))) {
        const rel = join(dir, name);
        if (
          name === "node_modules" ||
          name === "__tests__" ||
          name.startsWith(".")
        )
          continue;
        if (statSync(join(repo, rel)).isDirectory()) walk(rel);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const src = stripComments(read(rel));
          const directUpdate = /\.update\(\s*\{[^}]*\btriage_status\s*:/.test(
            src,
          );
          const setsViaRpc = /p_set_triage_status:\s*(?!null\b)\S/.test(src);
          const humanRpc = /rpc\(\s*"set_clone_alert_triage"/.test(src);
          if (directUpdate || setsViaRpc || humanRpc) found.push(rel);
        }
      }
    };
    for (const d of [
      "apps/web/app",
      "apps/web/lib",
      "apps/web/scripts",
      "packages",
    ])
      walk(d);
    expect(found.sort()).toEqual([
      "apps/web/app/api/admin/clone-watch/triage/route.ts", // human
      "apps/web/app/api/inngest/functions/clone-watch-urlscan-retrieve.ts", // persist_urlscan
      "apps/web/lib/clone-watch/auto-park.ts", // auto_park
      "apps/web/lib/clone-watch/netcraft-report.ts", // merge_submission
    ]);
  });

  it("auto-park writes what the spec says", () => {
    const src = stripComments(read("apps/web/lib/clone-watch/auto-park.ts"));
    const update = src.match(/\.update\(\{([\s\S]*?)\}\)([\s\S]*?)\.select/)!;
    expect(update[1]).toMatch(/triage_status:\s*"needs_investigation"/);
    expect(update[1]).toMatch(/triage_source:\s*"machine"/);
    expect(update[1]).toMatch(/triage_at:/);
    expect(update[2]).toMatch(/\.eq\("triage_status", "pending"\)/);
    expect(TRIAGE_WRITERS.auto_park).toMatchObject({
      to: ["needs_investigation"],
      from: ["pending"],
      source: "machine",
    });
  });

  it("a scan only ever suggests what the persist writer may set", () => {
    for (const c of [
      "parked_for_sale",
      "unresolved",
      "likely_phishing",
      "neutral",
    ] as const) {
      const s = suggestTriageTransition(c);
      if (s !== null) expect(TRIAGE_WRITERS.persist_urlscan.to).toContain(s);
    }
  });

  it("the Netcraft writer sets what the spec says", () => {
    const src = stripComments(
      read("apps/web/lib/clone-watch/netcraft-report.ts"),
    );
    const set = [...src.matchAll(/p_set_triage_status:\s*"(\w+)"/g)].map(
      (m) => m[1],
    );
    expect(set.length).toBeGreaterThan(0);
    for (const s of set)
      expect(TRIAGE_WRITERS.merge_submission.to).toContain(s);
  });

  it("the human route passes p_source 'human'", () => {
    const src = stripComments(
      read("apps/web/app/api/admin/clone-watch/triage/route.ts"),
    );
    // Either explicit, or the SQL default ('human') by omission.
    const explicit = src.match(/p_source:\s*"(\w+)"/);
    if (explicit) expect(explicit[1]).toBe("human");
  });
});

describe("the spec's own rules", () => {
  const writers = Object.entries(TRIAGE_WRITERS) as Array<
    [TriageWriterId, (typeof TRIAGE_WRITERS)[TriageWriterId]]
  >;

  it("no machine writer issues a verdict or a reset", () => {
    for (const [id, w] of writers) {
      if (w.source !== "machine") continue;
      for (const to of w.to)
        expect(
          MACHINE_STATUSES as readonly string[],
          `${id} → ${to}`,
        ).toContain(to);
    }
  });

  it("no machine writer moves a row out of a human's verdict, except to execute it", () => {
    for (const [id, w] of writers) {
      if (w.source !== "machine") continue;
      for (const from of w.from) {
        if (from === null || !DECIDED_STATUSES.has(from)) continue;
        for (const to of w.to) {
          if (from === to) continue;
          expect(`${id}: ${from} → ${to}`).toBe(
            "merge_submission: tp_confirmed → tp_actioned",
          );
        }
      }
    }
    expect(canWriteTriage("merge_submission", "fp", "tp_actioned")).toBe(false);
    expect(canWriteTriage("persist_urlscan", "fp", "needs_investigation")).toBe(
      false,
    );
    expect(
      canWriteTriage("auto_park", "needs_investigation", "needs_investigation"),
    ).toBe(true); // no-op
  });

  it("a human may make any move", () => {
    for (const from of [...TRIAGE_STATUSES, null]) {
      for (const to of TRIAGE_STATUSES)
        expect(canWriteTriage("human", from, to)).toBe(true);
    }
  });

  it("a machine change is always a machine origin; an unchanged status keeps its origin", () => {
    for (const [id, w] of writers) {
      if (w.source !== "machine") continue;
      for (const from of w.from) {
        for (const to of w.to) {
          const after = sourceAfterWrite(id, from, to, "human");
          if (from === to) expect(after).toBe("human");
          else if (!(id === "merge_submission" && from === "tp_confirmed"))
            expect(after, `${id} ${from}→${to}`).toBe("machine");
        }
      }
    }
  });

  it("the Netcraft writer keeps a human origin only for tp_confirmed → tp_actioned", () => {
    expect(
      sourceAfterWrite(
        "merge_submission",
        "tp_confirmed",
        "tp_actioned",
        "human",
      ),
    ).toBe("human");
    expect(
      sourceAfterWrite("merge_submission", "tp_confirmed", "tp_actioned", null),
    ).toBeNull();
    expect(
      sourceAfterWrite(
        "merge_submission",
        "needs_investigation",
        "tp_actioned",
        "human",
      ),
    ).toBe("machine");
  });

  it("verdictOrigin: the source when stamped, else the pre-v335 note rule", () => {
    expect(
      verdictOrigin({ triage_source: "machine", triage_notes: null }),
    ).toBe("machine");
    expect(
      verdictOrigin({ triage_source: "human", triage_notes: "auto-park: x" }),
    ).toBe("human");
    expect(
      verdictOrigin({ triage_source: null, triage_notes: "auto-park: x" }),
    ).toBe("machine");
    expect(
      verdictOrigin({
        triage_source: null,
        triage_notes: "[matcher-v4-audit] y",
      }),
    ).toBe("machine");
    expect(
      verdictOrigin({ triage_source: null, triage_notes: "looked at it" }),
    ).toBe("human");
    expect(verdictOrigin({ triage_source: null, triage_notes: null })).toBe(
      "human",
    );
  });

  it("the note rule is the one clone_watch_readiness_inputs applies", () => {
    const sql = read("supabase/migration-v335-clone-watch-readiness.sql");
    const prefixes = [...sql.matchAll(/NOT LIKE '([^%']+)%'/g)]
      .map((m) => m[1])
      .sort();
    expect(prefixes).toEqual([
      "[matcher-v4-audit]",
      "auto-park",
      "auto-triage",
    ]);
  });
});

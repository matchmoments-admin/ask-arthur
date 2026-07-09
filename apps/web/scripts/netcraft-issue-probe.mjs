#!/usr/bin/env node
// Netcraft report_issue — ONE-SHOT validation harness (BLOCK-0 of PR2).
//
// Purpose: settle two unknowns empirically BEFORE flipping the reporter live —
//   (1) does POST /submission/{uuid}/report_issue accept our body shape
//       (url_misclassifications + additional_info + filename_misclassifications:[])
//       or does it require a non-empty filename array? (BLOCK-1)
//   (2) what does Netcraft do with a SECOND report_issue on a uuid that already
//       has one (has_issues=1)? (BLOCK-3) — run this script TWICE on the same uuid.
//
// This does a REAL, irreversible POST that spends a sliver of reporter standing,
// so it is double-gated: you must pass a uuid AND set NETCRAFT_ISSUE_PROBE_CONFIRM=yes.
// Keyless (no API key). Standalone (zero deps, no @/ imports) so it can never be
// cron-scheduled and never runs by accident.
//
// Usage:
//   node apps/web/scripts/netcraft-issue-probe.mjs <submission-uuid> [--dry]
//   NETCRAFT_ISSUE_PROBE_CONFIRM=yes node apps/web/scripts/netcraft-issue-probe.mjs <uuid>
//
//   --dry  : build + print the payload, do NOT post (safe preview).

const BASE = "https://report.netcraft.com/api/v3";
const uuid = process.argv[2];
const dry = process.argv.includes("--dry");

if (!uuid || uuid.startsWith("--")) {
  console.error("usage: node netcraft-issue-probe.mjs <submission-uuid> [--dry]");
  process.exit(1);
}

function stripPii(u) {
  try {
    const url = new URL(u);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return u;
  }
}

const j = async (url, init) => {
  const r = await fetch(url, init);
  const text = await r.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: r.status, headers: Object.fromEntries(r.headers), body };
};

const run = async () => {
  const sub = await j(`${BASE}/submission/${uuid}`);
  console.log(
    `submission: state=${sub.body?.state} is_archived=${sub.body?.is_archived} ` +
      `has_issues=${sub.body?.has_issues} state_counts=${JSON.stringify(sub.body?.state_counts?.urls)}`,
  );
  if (sub.body?.is_archived) {
    console.error("submission is ARCHIVED — report_issue would 404. Pick a newer uuid.");
    process.exit(2);
  }

  const urls = await j(`${BASE}/submission/${uuid}/urls?count=500`);
  const noThreats = (urls.body?.urls ?? []).filter((u) => u.url_state === "no threats");
  if (noThreats.length === 0) {
    console.error("no 'no threats' URLs in this submission — nothing to report. Pick another uuid.");
    process.exit(3);
  }
  console.log(`found ${noThreats.length} 'no threats' URLs (will report up to 5):`);
  const pick = noThreats.slice(0, 5);
  for (const u of pick) console.log(`  • ${u.hostname}`);

  const payload = {
    additional_info:
      "False negative — brand-impersonation lookalike(s) not actioned. The URL(s) " +
      "below are typosquat/lookalike domains of Australian brands detected via Ask " +
      "Arthur clone-watch. Please re-review for brand infringement.",
    url_misclassifications: pick.map((u) => ({
      reason: `Branded lookalike; Netcraft graded this URL "no threats".`,
      url: stripPii(u.url),
    })),
    filename_misclassifications: [],
  };

  console.log("\n=== payload ===\n" + JSON.stringify(payload, null, 2));

  if (dry) {
    console.log("\n[--dry] not posting. Re-run without --dry (and CONFIRM=yes) to POST.");
    return;
  }
  if (process.env.NETCRAFT_ISSUE_PROBE_CONFIRM !== "yes") {
    console.error(
      "\nREFUSING to POST: set NETCRAFT_ISSUE_PROBE_CONFIRM=yes to make the real request.",
    );
    process.exit(4);
  }

  console.log(`\nPOST ${BASE}/submission/${uuid}/report_issue ...`);
  const res = await j(`${BASE}/submission/${uuid}/report_issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  console.log("=== response ===");
  console.log("status:", res.status);
  console.log("body:", JSON.stringify(res.body, null, 2));
  console.log(
    "\nNext: re-run this same command to test a SECOND report_issue on the now-has_issues submission (BLOCK-3).",
  );
};

run().catch((e) => {
  console.error("probe failed:", e);
  process.exit(10);
});

import { describe, expect, it } from "vitest";
import { buildWeaponisedTelegramMessage } from "@/app/api/inngest/functions/clone-watch-notify-weaponised";
import { buildTelegramSummaryMessage } from "@/app/api/inngest/functions/clone-watch-notify-brand-prepare";
import { buildTelegramMessage as buildFpClusterMessage } from "@/app/api/inngest/functions/clone-watch-fp-cluster-digest";

// Behaviour preservation for the move of admin Telegram messages onto the
// shared `html` template (packages/utils/src/html.ts). For benign input the
// rendered message must be byte-identical to what the old string builders
// produced — the expected strings below are the old templates evaluated by
// hand. Hostile input is the only thing that changes: it is now escaped
// everywhere, including interpolations the old builders left raw.

describe("admin Telegram messages — byte-identical for benign input", () => {
  it("weaponised alert (staged)", () => {
    const msg = buildWeaponisedTelegramMessage({
      stage: "staged",
      brand: "NAB",
      candidateDomain: "nab-login.example",
      via: "recheck",
      urlscanResultUrl: "https://urlscan.io/result/abc/",
      channelType: "email",
    }).value;
    expect(msg).toBe(
      [
        "🚨 <b>Clone-watch — lookalike WEAPONISED</b>",
        "",
        "Brand: <b>NAB</b>",
        "Domain: <code>nab-login.example</code> (via recheck)",
        "Evidence: https://urlscan.io/result/abc/",
        "",
        "Brand alert staged for approval (email).",
        "Review and send: https://askarthur.au/admin/clone-watch#approvals",
      ].join("\n"),
    );
  });

  it("prepare summary", () => {
    const msg = buildTelegramSummaryMessage({
      batchesPrepared: 2,
      groupsFailed: 1,
      groupsSkippedCooldown: 0,
      dashboardUrl: "https://askarthur.au/admin/clone-watch",
    }).value;
    expect(msg).toBe(
      [
        "🛡️ <b>Clone-watch — prepare summary</b>",
        "",
        "<b>2</b> batches awaiting your approval.",
        "⚠️ 1 group failed during render/assign (check logs).",
        "",
        'Review and send at <a href="https://askarthur.au/admin/clone-watch">https://askarthur.au/admin/clone-watch</a>',
      ].join("\n"),
    );
  });

  it("fp-cluster digest", () => {
    const msg = buildFpClusterMessage(
      [
        {
          brand: "Bonds",
          tld: "design",
          prefix: "bond",
          count: 3,
          examples: ["bondi.design", "bondx.design"],
          proposed_exception: "/^bond[a-z0-9-]*\\.design$/",
        },
      ],
      27,
    ).value;
    expect(msg).toBe(
      [
        "📋 <b>Clone-watch — FP patterns (last 14d)</b>",
        "",
        "<b>27</b> total FPs · <b>1</b> repeat patterns",
        "",
        "• <b>Bonds</b> — <b>3</b> FPs on <code>.design</code>",
        "  <code>bondi.design</code>, <code>bondx.design</code>",
        "  Proposed exception: <code>/^bond[a-z0-9-]*\\.design$/</code>",
        "",
        "Apply by editing <code>packages/shopfront-glue/src/au-brand-watchlist.ts</code> if you agree.",
      ].join("\n"),
    );
  });
});

describe("admin Telegram messages — hostile input is escaped everywhere", () => {
  it("escapes values the old builder interpolated raw (evidence URL, recipient)", () => {
    const msg = buildWeaponisedTelegramMessage({
      stage: "manual_channel",
      brand: "AT&T",
      candidateDomain: "x.example",
      via: "retrieve",
      urlscanResultUrl: "https://u.example/?a=1&b=<2>",
      recipient: 'https://form.example/?q="x"',
      detail: "contact_form",
    }).value;
    expect(msg).toContain("Brand: <b>AT&amp;T</b>");
    expect(msg).toContain("Evidence: https://u.example/?a=1&amp;b=&lt;2&gt;");
    expect(msg).toContain("Open: https://form.example/?q=&quot;x&quot;");
    expect(msg).not.toMatch(/<2>|"x"/);
  });
});

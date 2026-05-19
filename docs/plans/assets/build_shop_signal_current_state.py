#!/usr/bin/env python3
"""Build the Shop Signal CURRENT-STATE architecture diagram (2026-05-20).

Companion to build_shop_signal_diagram.py (which mirrors the Mermaid block
in docs/plans/shop-guard-v2.md §2). This one is a zoom-out snapshot post
PR #328 (the pre-launch tidy) — it adds annotations the planning diagram
doesn't carry:

  - The Voyage embedding gap (scam-report-embed.ts does NOT read
    shopSignal.commerceFlags — backlog candidate).
  - The dual call-site lockstep between /api/analyze and runAnalysisCore
    (cross-ref comments shipped in PR #328).
  - The Plausible side-channel + the scam_reports.analysis_result JSONB
    persistence that backs the 30-day measurement window.
  - A four-state legend (shipped / Stage 1 gated / Stage 2 gated / known
    gap).

The PNG sibling is a layout sanity check; the .excalidraw file is the
editable source. Regenerate:

    python3 docs/plans/assets/build_shop_signal_current_state.py
    python3 ~/.claude/skills/excalidraw-diagram/render_diagram.py \
        docs/plans/assets/shop-signal-current-state.excalidraw
"""

import json

# Palette (Ask Arthur — stages mapped semantically)
SHIPPED_FILL   = "#ecfdf5"   # safe_bg (mint)
SHIPPED_STROKE = "#1b5e20"   # safe (forest green)
STAGE1_FILL    = "#fff8e1"   # warn_bg (cream)
STAGE1_STROKE  = "#a16207"   # amber-700 (clearer "Stage 1 gated")
STAGE2_FILL    = "#fed7aa"   # orange-200 (warmer than Stage 1, distinct)
STAGE2_STROKE  = "#9a3412"   # orange-800
GAP_FILL       = "#fef2f2"   # danger_bg (blush)
GAP_STROKE     = "#b91c1c"   # red-700
GROUP_FILL     = "transparent"
GROUP_STROKE   = "#42526e"   # muted slate
TEXT           = "#171717"
TITLE_COLOR    = "#001f3f"
ACCENT         = "#008a98"   # action teal — for the "happy-path" arrow set

elements = []
_next_seed = [1]

def seed():
    _next_seed[0] += 1
    return _next_seed[0] * 137

def rect(id, x, y, w, h, fill=SHIPPED_FILL, stroke=SHIPPED_STROKE, stroke_style="solid",
         stroke_width=2, rounded=True, text=None, font_size=14, font_family=2):
    el = {
        "id": id, "type": "rectangle",
        "x": x, "y": y, "width": w, "height": h,
        "angle": 0,
        "strokeColor": stroke,
        "backgroundColor": fill,
        "fillStyle": "solid",
        "strokeWidth": stroke_width,
        "strokeStyle": stroke_style,
        "roughness": 1,
        "opacity": 100,
        "groupIds": [], "frameId": None,
        "roundness": {"type": 3} if rounded else None,
        "seed": seed(), "version": 1, "versionNonce": seed(),
        "isDeleted": False, "boundElements": [],
        "updated": 0, "link": None, "locked": False,
    }
    elements.append(el)
    if text is not None:
        text_id = f"{id}-label"
        text_el = {
            "id": text_id, "type": "text",
            "x": x, "y": y, "width": w, "height": h,
            "angle": 0,
            "strokeColor": TEXT,
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": 1, "strokeStyle": "solid",
            "roughness": 1, "opacity": 100,
            "groupIds": [], "frameId": None, "roundness": None,
            "seed": seed(), "version": 1, "versionNonce": seed(),
            "isDeleted": False, "boundElements": [],
            "updated": 0, "link": None, "locked": False,
            "text": text, "originalText": text,
            "fontSize": font_size, "fontFamily": font_family,
            "textAlign": "center", "verticalAlign": "middle",
            "containerId": id,
            "lineHeight": 1.25, "baseline": int(font_size * 0.9),
        }
        el["boundElements"] = [{"id": text_id, "type": "text"}]
        elements.append(text_el)
    return el

def free_text(x, y, w, h, text, font_size=14, color=TEXT, align="left", font_family=2):
    text_el = {
        "id": f"text-{seed()}", "type": "text",
        "x": x, "y": y, "width": w, "height": h,
        "angle": 0,
        "strokeColor": color,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1, "strokeStyle": "solid",
        "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": None, "roundness": None,
        "seed": seed(), "version": 1, "versionNonce": seed(),
        "isDeleted": False, "boundElements": [],
        "updated": 0, "link": None, "locked": False,
        "text": text, "originalText": text,
        "fontSize": font_size, "fontFamily": font_family,
        "textAlign": align, "verticalAlign": "top",
        "containerId": None,
        "lineHeight": 1.25, "baseline": int(font_size * 0.9),
    }
    elements.append(text_el)
    return text_el

def arrow(id, x0, y0, x1, y1, stroke=ACCENT, stroke_style="solid", stroke_width=2,
          end_arrow="arrow", label=None):
    points = [[0, 0], [x1 - x0, y1 - y0]]
    el = {
        "id": id, "type": "arrow",
        "x": x0, "y": y0,
        "width": abs(x1 - x0), "height": abs(y1 - y0),
        "angle": 0,
        "strokeColor": stroke,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": stroke_width,
        "strokeStyle": stroke_style,
        "roughness": 1, "opacity": 100,
        "groupIds": [], "frameId": None, "roundness": None,
        "seed": seed(), "version": 1, "versionNonce": seed(),
        "isDeleted": False, "boundElements": [],
        "updated": 0, "link": None, "locked": False,
        "points": points, "lastCommittedPoint": None,
        "startBinding": None, "endBinding": None,
        "startArrowhead": None, "endArrowhead": end_arrow,
        "elbowed": False,
    }
    elements.append(el)
    if label:
        mid_x = (x0 + x1) / 2
        mid_y = (y0 + y1) / 2
        free_text(mid_x - 90, mid_y - 18, 180, 24, label,
                  font_size=10, color=stroke, align="center")

# ── Layout grid ────────────────────────────────────────────────────────
COL_W = 280
BOX_W = 240
BOX_H = 60
COL_GAP = 60

COL_X = {
    "input":  60,
    "route":  60 + 1 * (COL_W + COL_GAP),
    "module": 60 + 2 * (COL_W + COL_GAP),
    "output": 60 + 3 * (COL_W + COL_GAP),
    "stage1": 60 + 4 * (COL_W + COL_GAP),
}
BOX_INSET = 20
BOX_X = {k: v + BOX_INSET for k, v in COL_X.items()}

# ── Title bar ─────────────────────────────────────────────────────────
free_text(60, 40, 1700, 36,
          "Shop Signal — current state (2026-05-20, post-PR #328)",
          font_size=26, color=TITLE_COLOR, font_family=2)
free_text(60, 84, 1700, 22,
          "Engineering Module: shop-signal.ts inside scam-engine. User-facing capability: Shop Guard. "
          "Plan: docs/plans/shop-guard-v2.md  ·  Ops: docs/ops/shop-signal-config.md  ·  Measurement: docs/ops/shop-signal-measurement.md",
          font_size=11, color="#5a6b7e", font_family=2)

# ── Legend (top-right, well below the subtitle) ────────────────────────
LEGEND_X = 1490
LEGEND_Y = 140
LEGEND_GAP = 32
def legend_swatch(idx, fill, stroke, dashed, label):
    y = LEGEND_Y + idx * LEGEND_GAP
    rect(f"leg-{idx}", LEGEND_X, y, 28, 20, fill=fill, stroke=stroke,
         stroke_style=("dashed" if dashed else "solid"), stroke_width=2,
         rounded=True, text=None)
    free_text(LEGEND_X + 40, y + 2, 260, 20, label,
              font_size=11, color=TEXT, font_family=2)

free_text(LEGEND_X, LEGEND_Y - 22, 300, 18, "Legend",
          font_size=12, color=TITLE_COLOR, font_family=2)
legend_swatch(0, SHIPPED_FILL, SHIPPED_STROKE, False, "Shipped + live behind FF_SHOP_SIGNAL")
legend_swatch(1, STAGE1_FILL,  STAGE1_STROKE,  True,  "Stage 1 (gated on 30-day window)")
legend_swatch(2, STAGE2_FILL,  STAGE2_STROKE,  True,  "Stage 2 (gated on Stage 1)")
legend_swatch(3, GAP_FILL,     GAP_STROKE,     True,  "Known gap")

# ── Group outlines (drawn first so boxes sit on top) ──────────────────
GROUP_TOP = 230
GROUP_BOTTOM = 1040

def group(col_key, label):
    x = COL_X[col_key]
    rect(f"g-{col_key}", x, GROUP_TOP, COL_W, GROUP_BOTTOM - GROUP_TOP,
         fill=GROUP_FILL, stroke=GROUP_STROKE,
         stroke_style="solid", stroke_width=1, rounded=True, text=None)
    free_text(x + 16, GROUP_TOP + 12, COL_W - 32, 18, label,
              font_size=12, color=GROUP_STROKE, font_family=2)

group("input",  "Inbound Adapters")
group("route",  "Seams (analyze spine)")
group("module", "shop-signal Module")
group("output", "Output Adapters + persistence")
group("stage1", "Stage 1+ enrichments (gated)")

# ── Column 1: Inbound Adapters ────────────────────────────────────────
INPUTS = [
    ("i-web",       "Web drawer\nScamChecker.tsx",                                "shipped"),
    ("i-share",     "Share Target route\ndetectInappReferrer()\nUA + Referer fallback", "shipped"),
    ("i-telegram",  "Telegram bot\n→ analyzeForBot",                              "shipped"),
    ("i-whatsapp",  "WhatsApp bot\n→ analyzeForBot",                              "shipped"),
    ("i-slack",     "Slack bot\n→ analyzeForBot",                                 "shipped"),
    ("i-messenger", "Messenger bot\n→ analyzeForBot",                             "shipped"),
    ("i-extension", "Browser extension popup\nactiveTab\nStage 2 / #323",         "stage2"),
    ("i-b2b",       "B2B /api/v1/shop-check\nStage 2 / #322",                     "stage2"),
]
INPUT_TOP = 270
INPUT_GAP = 92
input_y_by_id = {}
for idx, (eid, text, stage) in enumerate(INPUTS):
    y = INPUT_TOP + idx * INPUT_GAP
    if stage == "shipped":
        fill, stroke, style = SHIPPED_FILL, SHIPPED_STROKE, "solid"
    else:  # stage2
        fill, stroke, style = STAGE2_FILL, STAGE2_STROKE, "dashed"
    box_h = 70 if "\n" in text and text.count("\n") >= 2 else BOX_H
    rect(eid, BOX_X["input"], y, BOX_W, box_h,
         fill=fill, stroke=stroke, stroke_style=style, text=text, font_size=11)
    input_y_by_id[eid] = y

# ── Column 2: Seams ────────────────────────────────────────────────────
ROUTES = [
    ("r-api",  "/api/analyze route\napp/api/analyze/route.ts:307",   "shipped"),
    ("r-core", "runAnalysisCore\nscam-engine/analyze-core.ts:231",   "shipped"),
    ("r-bot",  "analyzeForBot\nbot-core/analyze.ts",                  "shipped"),
]
ROUTE_TOP = 290
ROUTE_GAP = 200
route_y_by_id = {}
for idx, (eid, text, stage) in enumerate(ROUTES):
    y = ROUTE_TOP + idx * ROUTE_GAP
    rect(eid, BOX_X["route"], y, BOX_W, BOX_H,
         fill=SHIPPED_FILL, stroke=SHIPPED_STROKE, text=text, font_size=11)
    route_y_by_id[eid] = y

# LOCKSTEP annotation between /api/analyze and runAnalysisCore
# Two parallel dotted lines on either side of the gap label so the label
# sits between them and reads clearly.
lockstep_x_left = BOX_X["route"] + 36
lockstep_x_right = BOX_X["route"] + BOX_W - 36
lockstep_y0 = route_y_by_id["r-api"] + BOX_H
lockstep_y1 = route_y_by_id["r-core"]
arrow("a-lockstep-l", lockstep_x_left, lockstep_y0, lockstep_x_left, lockstep_y1,
      stroke=GROUP_STROKE, stroke_style="dotted", stroke_width=2, end_arrow=None)
arrow("a-lockstep-r", lockstep_x_right, lockstep_y0, lockstep_x_right, lockstep_y1,
      stroke=GROUP_STROKE, stroke_style="dotted", stroke_width=2, end_arrow=None)
free_text(BOX_X["route"] + 30, (lockstep_y0 + lockstep_y1) // 2 - 38, BOX_W - 60, 76,
          "LOCKSTEP\nDual call-site\ncross-ref in both\nfiles (PR #328)\nPhase 5 buildAnalyze\nwill consolidate",
          font_size=9, color=GROUP_STROKE, align="center")

# ── Column 3: Module ───────────────────────────────────────────────────
# One big container box + three sub-rectangles inside
MOD_X = BOX_X["module"]
MOD_TOP = 290
MOD_H_BIG = 380
rect("m-container", MOD_X, MOD_TOP, BOX_W, MOD_H_BIG,
     fill=SHIPPED_FILL, stroke=SHIPPED_STROKE, stroke_width=3, text=None)
free_text(MOD_X + 12, MOD_TOP + 12, BOX_W - 24, 20,
          "shop-signal.ts (pure Module)",
          font_size=13, color=SHIPPED_STROKE, font_family=2)

# Three sub-boxes inside container
SUB_X = MOD_X + 14
SUB_W = BOX_W - 28
SUB_H = 76
SUB_TOP = MOD_TOP + 44
SUB_GAP = 18
sub_y_by_id = {}
SUBS = [
    ("m-detect",  "detectCommerceSignal()\nURL TLD + path + platform hint\nOR text commerce verbs"),
    ("m-extract", "extractCommerceFlags()\n11-tag COMMERCE_FLAG_TAXONOMY\n(payid-scam, relative-will-collect, …)"),
    ("m-build",   "buildShopSignal()\n→ ShopSignal payload"),
]
for idx, (eid, text) in enumerate(SUBS):
    y = SUB_TOP + idx * (SUB_H + SUB_GAP)
    rect(eid, SUB_X, y, SUB_W, SUB_H,
         fill="#ffffff", stroke=SHIPPED_STROKE, stroke_width=1,
         text=text, font_size=10)
    sub_y_by_id[eid] = y

# Annotation below the module
free_text(MOD_X, MOD_TOP + MOD_H_BIG + 12, BOX_W, 50,
          "Gate: FF_SHOP_SIGNAL (default OFF, awaits morning flip).\n"
          "No I/O, no paid API at Stage 0. Deletion test passes.",
          font_size=10, color=GROUP_STROKE, align="center")

# Module sub-arrows: detect → extract → build
arrow("a-m1", SUB_X + SUB_W // 2, sub_y_by_id["m-detect"] + SUB_H,
      SUB_X + SUB_W // 2, sub_y_by_id["m-extract"],
      stroke=SHIPPED_STROKE, stroke_style="solid", stroke_width=1)
arrow("a-m2", SUB_X + SUB_W // 2, sub_y_by_id["m-extract"] + SUB_H,
      SUB_X + SUB_W // 2, sub_y_by_id["m-build"],
      stroke=SHIPPED_STROKE, stroke_style="solid", stroke_width=1)

# ── Column 4: Output Adapters + persistence ────────────────────────────
OUTPUTS = [
    ("o-contract", "AnalysisResult.shopSignal\n(the Interface — Zod-validated)",          "shipped"),
    ("o-chips",    "Web ResultCard chips\n11 tags + 'Online shop detected' fallback",      "shipped"),
    ("o-bots",     "Bot formatter summary line\n(×4: Telegram/WhatsApp/Slack/Messenger)",  "shipped"),
    ("o-jsonb",    "scam_reports.analysis_result JSONB\nv21 GIN(jsonb_path_ops) — no migration", "shipped"),
    ("o-plausible","Plausible events\nscam_check_submitted + shop_signal_emitted",         "shipped"),
]
OUTPUT_TOP = 270
OUTPUT_GAP = 105
output_y_by_id = {}
for idx, (eid, text, stage) in enumerate(OUTPUTS):
    y = OUTPUT_TOP + idx * OUTPUT_GAP
    rect(eid, BOX_X["output"], y, BOX_W, 78,
         fill=SHIPPED_FILL, stroke=SHIPPED_STROKE, text=text, font_size=10)
    output_y_by_id[eid] = y

# ── Column 5: Stage 1 enrichments (gated) ──────────────────────────────
STAGE1 = [
    ("s-apivoid", "APIVoid Adapter\n~A$0.003/call Growth tier\nSHOP_SIGNAL_CAP_USD=15\nPR 2 / #319",         True),
    ("s-brake",   "feature_brakes.shop_signal\nrow (underscore — matches\nphone_footprint / reddit_intel)",  True),
    ("s-table",   "shop_checks table\nverdict TEXT CHECK 4-value\n90d BRIN TTL, btree(url_hash)\nPR 3 / #320", True),
    ("s-inngest", "Inngest fan-out\nshop.signal.evaluated.v1\n+ ResultCard accordion\nPR 4 / #321",          True),
]
S1_TOP = 270
S1_GAP = 105
s1_y_by_id = {}
for idx, (eid, text, dashed) in enumerate(STAGE1):
    y = S1_TOP + idx * S1_GAP
    rect(eid, BOX_X["stage1"], y, BOX_W, 90,
         fill=STAGE1_FILL, stroke=STAGE1_STROKE,
         stroke_style=("dashed" if dashed else "solid"),
         text=text, font_size=10)
    s1_y_by_id[eid] = y

# ── Known-gap callout: Voyage embedding ────────────────────────────────
GAP_X = BOX_X["output"] + 50
GAP_Y = GROUP_BOTTOM + 70
rect("gap-voyage", GAP_X, GAP_Y, BOX_W + 100, 130,
     fill=GAP_FILL, stroke=GAP_STROKE, stroke_style="dashed", stroke_width=2,
     text=("KNOWN GAP — Voyage embedding\n"
           "scam-report-embed.ts builds embed text from\n"
           "scrubbed_content + scam_type + channel +\n"
           "impersonated_brand. Does NOT read\n"
           "shopSignal.commerceFlags. Near-duplicate\n"
           "commerce scams embed to identical vectors.\n"
           "Backlog candidate post-Stage-1 measurement."),
     font_size=10)

# Dotted red arrow from scam_reports JSONB to the gap
gap_arrow_x0 = BOX_X["output"] + BOX_W // 2
gap_arrow_y0 = output_y_by_id["o-jsonb"] + 78
gap_arrow_x1 = GAP_X + (BOX_W + 100) // 2
gap_arrow_y1 = GAP_Y
arrow("a-gap", gap_arrow_x0, gap_arrow_y0, gap_arrow_x1, gap_arrow_y1,
      stroke=GAP_STROKE, stroke_style="dotted", stroke_width=2,
      label="? not consumed")

# ── External dependencies cluster (bottom-left) ────────────────────────
EXT_TOP = GROUP_BOTTOM + 70
EXT_BOX_W = 220
EXT_BOX_H = 56
EXT_GAP = 18
EXT_X = 80

ext_deps = [
    ("ext-claude",    "Anthropic Claude Haiku 4.5\n(existing — no shop-signal\nprompt fork at Stage 0)", "shipped"),
    ("ext-plausible", "Plausible.io\n(custom-event analytics)",                                          "shipped"),
    ("ext-apivoid",   "APIVoid Site Trustworthiness\n(10 credits/call, Stage 1)",                        "stage1"),
]
free_text(EXT_X, EXT_TOP - 24, 600, 18, "External dependencies",
          font_size=12, color=GROUP_STROKE, font_family=2)
for idx, (eid, text, stage) in enumerate(ext_deps):
    x = EXT_X + idx * (EXT_BOX_W + EXT_GAP)
    if stage == "shipped":
        fill, stroke, style = SHIPPED_FILL, SHIPPED_STROKE, "solid"
    else:
        fill, stroke, style = STAGE1_FILL, STAGE1_STROKE, "dashed"
    rect(eid, x, EXT_TOP, EXT_BOX_W, EXT_BOX_H,
         fill=fill, stroke=stroke, stroke_style=style, text=text, font_size=10)

# ── Cross-column arrows (the happy path) ────────────────────────────────
# Build a lookup for the actual rendered height per input box (some are taller
# because of the 3-line texts) so arrow endpoints hit the box mid-line.
input_text_by_id = {eid: text for eid, text, _stage in INPUTS}
def input_box_h(eid):
    return 70 if input_text_by_id[eid].count("\n") >= 2 else BOX_H

# Web/Share-target → /api/analyze
for src in ["i-web", "i-share"]:
    y0 = input_y_by_id[src] + input_box_h(src) // 2
    arrow(f"a-{src}-r-api", BOX_X["input"] + BOX_W, y0,
          BOX_X["route"], route_y_by_id["r-api"] + BOX_H // 2,
          stroke=ACCENT, stroke_width=1)

# 4 bots → analyzeForBot
for src in ["i-telegram", "i-whatsapp", "i-slack", "i-messenger"]:
    y0 = input_y_by_id[src] + BOX_H // 2
    arrow(f"a-{src}-r-bot", BOX_X["input"] + BOX_W, y0,
          BOX_X["route"], route_y_by_id["r-bot"] + BOX_H // 2,
          stroke=ACCENT, stroke_width=1)

# analyzeForBot → runAnalysisCore
arrow("a-bot-core",
      BOX_X["route"] + BOX_W // 2, route_y_by_id["r-bot"],
      BOX_X["route"] + BOX_W // 2, route_y_by_id["r-core"] + BOX_H,
      stroke=ACCENT, stroke_style="solid", stroke_width=2)

# /api/analyze → Module
arrow("a-api-mod",
      BOX_X["route"] + BOX_W, route_y_by_id["r-api"] + BOX_H // 2,
      BOX_X["module"], MOD_TOP + 60,
      stroke=ACCENT, stroke_width=2)

# runAnalysisCore → Module
arrow("a-core-mod",
      BOX_X["route"] + BOX_W, route_y_by_id["r-core"] + BOX_H // 2,
      BOX_X["module"], MOD_TOP + 200,
      stroke=ACCENT, stroke_width=2)

# Module → AnalysisResult.shopSignal (the Interface)
arrow("a-mod-out",
      BOX_X["module"] + BOX_W, MOD_TOP + MOD_H_BIG // 2,
      BOX_X["output"], output_y_by_id["o-contract"] + 39,
      stroke=ACCENT, stroke_width=2,
      label="ShopSignal payload")

# Output contract → consumers (4 arrows from contract to each adapter below)
contract_x_right = BOX_X["output"] + BOX_W
contract_y_centre = output_y_by_id["o-contract"] + 39
for target in ["o-chips", "o-bots", "o-jsonb", "o-plausible"]:
    arrow(f"a-contract-{target}",
          BOX_X["output"] + BOX_W // 2, output_y_by_id["o-contract"] + 78,
          BOX_X["output"] + BOX_W // 2, output_y_by_id[target],
          stroke=SHIPPED_STROKE, stroke_style="solid", stroke_width=1, end_arrow=None)

# Stage 1 arrows (gated): Module → APIVoid Adapter; APIVoid → shop_checks via Inngest
arrow("a-mod-s1",
      BOX_X["module"] + BOX_W, MOD_TOP + MOD_H_BIG // 2 + 40,
      BOX_X["stage1"], s1_y_by_id["s-apivoid"] + 45,
      stroke=STAGE1_STROKE, stroke_style="dashed", stroke_width=2,
      label="Stage 1: if commerce + paid feed ON")

# Vertical chain inside Stage 1
arrow("a-s1-1",
      BOX_X["stage1"] + BOX_W // 2, s1_y_by_id["s-apivoid"] + 90,
      BOX_X["stage1"] + BOX_W // 2, s1_y_by_id["s-brake"],
      stroke=STAGE1_STROKE, stroke_style="dashed", stroke_width=1, end_arrow=None)
arrow("a-s1-2",
      BOX_X["stage1"] + BOX_W // 2, s1_y_by_id["s-brake"] + 90,
      BOX_X["stage1"] + BOX_W // 2, s1_y_by_id["s-table"],
      stroke=STAGE1_STROKE, stroke_style="dashed", stroke_width=1, end_arrow=None)
arrow("a-s1-3",
      BOX_X["stage1"] + BOX_W // 2, s1_y_by_id["s-table"] + 90,
      BOX_X["stage1"] + BOX_W // 2, s1_y_by_id["s-inngest"],
      stroke=STAGE1_STROKE, stroke_style="dashed", stroke_width=1, end_arrow=None)

# Stage 2 surfaces back-arrow into the route (when they ship, they'll call the same seams)
arrow("a-ext-route",
      BOX_X["input"] + BOX_W, input_y_by_id["i-extension"] + 35,
      BOX_X["route"], route_y_by_id["r-api"] + BOX_H + 30,
      stroke=STAGE2_STROKE, stroke_style="dashed", stroke_width=1)
arrow("a-b2b-route",
      BOX_X["input"] + BOX_W, input_y_by_id["i-b2b"] + 35,
      BOX_X["route"], route_y_by_id["r-core"] + BOX_H // 2 + 50,
      stroke=STAGE2_STROKE, stroke_style="dashed", stroke_width=1)

# ── Emit ───────────────────────────────────────────────────────────────
out = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {"viewBackgroundColor": "#ffffff", "gridSize": None},
    "files": {},
}

import os
out_path = os.path.join(os.path.dirname(__file__), "shop-signal-current-state.excalidraw")
with open(out_path, "w") as f:
    json.dump(out, f, indent=2)
print(f"wrote {out_path}  ({len(elements)} elements)")

#!/usr/bin/env python3
"""Build the Shop Signal architecture diagram as an .excalidraw file.

Mirrors the Mermaid block in docs/plans/shop-guard-v2.md §2. The PNG sibling
is a layout sanity check; the .excalidraw file is the editable source.
"""

import json
import random

random.seed(42)

# Palette (Ask Arthur — stages mapped semantically)
STAGE0_FILL = "#ecfdf5"   # safe_bg (mint)
STAGE0_STROKE = "#1b5e20" # safe (forest green)
STAGE1_FILL = "#fff8e1"   # warn_bg (cream)
STAGE1_STROKE = "#e65100" # warn (burnt orange)
STAGE2_FILL = "#fef2f2"   # danger_bg (blush)
STAGE2_STROKE = "#b71c1c" # danger (oxblood)
GROUP_FILL = "transparent"
GROUP_STROKE = "#42526e"  # muted slate
TEXT = "#171717"
TITLE_COLOR = "#001f3f"

elements = []
_next_seed = [1]

def seed():
    _next_seed[0] += 1
    return _next_seed[0] * 137

def rect(id, x, y, w, h, fill=STAGE0_FILL, stroke=STAGE0_STROKE, stroke_style="solid",
         stroke_width=2, rounded=True, text=None, font_size=14, font_family=2):
    el = {
        "id": id,
        "type": "rectangle",
        "x": x, "y": y, "width": w, "height": h,
        "angle": 0,
        "strokeColor": stroke,
        "backgroundColor": fill,
        "fillStyle": "solid",
        "strokeWidth": stroke_width,
        "strokeStyle": stroke_style,
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": {"type": 3} if rounded else None,
        "seed": seed(),
        "version": 1,
        "versionNonce": seed(),
        "isDeleted": False,
        "boundElements": [],
        "updated": 0,
        "link": None,
        "locked": False,
    }
    elements.append(el)
    if text is not None:
        text_id = f"{id}-label"
        text_el = {
            "id": text_id,
            "type": "text",
            "x": x, "y": y, "width": w, "height": h,
            "angle": 0,
            "strokeColor": TEXT,
            "backgroundColor": "transparent",
            "fillStyle": "solid",
            "strokeWidth": 1,
            "strokeStyle": "solid",
            "roughness": 1,
            "opacity": 100,
            "groupIds": [],
            "frameId": None,
            "roundness": None,
            "seed": seed(),
            "version": 1,
            "versionNonce": seed(),
            "isDeleted": False,
            "boundElements": [],
            "updated": 0,
            "link": None,
            "locked": False,
            "text": text,
            "originalText": text,
            "fontSize": font_size,
            "fontFamily": font_family,
            "textAlign": "center",
            "verticalAlign": "middle",
            "containerId": id,
            "lineHeight": 1.25,
            "baseline": int(font_size * 0.9),
        }
        el["boundElements"] = [{"id": text_id, "type": "text"}]
        elements.append(text_el)
    return el

def free_text(x, y, w, h, text, font_size=14, color=TEXT, align="left", font_family=2):
    text_el = {
        "id": f"text-{seed()}",
        "type": "text",
        "x": x, "y": y, "width": w, "height": h,
        "angle": 0,
        "strokeColor": color,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 1,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": seed(),
        "version": 1,
        "versionNonce": seed(),
        "isDeleted": False,
        "boundElements": [],
        "updated": 0,
        "link": None,
        "locked": False,
        "text": text,
        "originalText": text,
        "fontSize": font_size,
        "fontFamily": font_family,
        "textAlign": align,
        "verticalAlign": "top",
        "containerId": None,
        "lineHeight": 1.25,
        "baseline": int(font_size * 0.9),
    }
    elements.append(text_el)
    return text_el

def arrow(id, x0, y0, x1, y1, stroke=STAGE0_STROKE, stroke_style="solid", stroke_width=2, label=None):
    points = [[0, 0], [x1 - x0, y1 - y0]]
    el = {
        "id": id,
        "type": "arrow",
        "x": x0, "y": y0,
        "width": abs(x1 - x0), "height": abs(y1 - y0),
        "angle": 0,
        "strokeColor": stroke,
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": stroke_width,
        "strokeStyle": stroke_style,
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": seed(),
        "version": 1,
        "versionNonce": seed(),
        "isDeleted": False,
        "boundElements": [],
        "updated": 0,
        "link": None,
        "locked": False,
        "points": points,
        "lastCommittedPoint": None,
        "startBinding": None,
        "endBinding": None,
        "startArrowhead": None,
        "endArrowhead": "arrow",
        "elbowed": False,
    }
    elements.append(el)
    if label:
        mid_x = (x0 + x1) / 2
        mid_y = (y0 + y1) / 2
        free_text(mid_x - 80, mid_y - 22, 160, 30, label, font_size=10, color=stroke, align="center")

# -------- Layout grid --------
# Five columns L→R: Inputs / Routing / Module / Stage 1+ / Outputs
COL_W = 280
BOX_W = 240
BOX_H = 56
COL_GAP = 60

COL_X = {
    "input": 60,
    "route": 60 + COL_W + COL_GAP,
    "module": 60 + 2 * (COL_W + COL_GAP),
    "stage1": 60 + 3 * (COL_W + COL_GAP),
    "output": 60 + 4 * (COL_W + COL_GAP),
}

# Box-x is the left edge of the box (column x + a little inset for box vs group)
BOX_INSET = 20
BOX_X = {k: v + BOX_INSET for k, v in COL_X.items()}

# Top: title
free_text(60, 30, 1600, 40, "Shop Signal — architecture (v0.1 → v1.0)",
          font_size=28, color=TITLE_COLOR, align="left", font_family=2)
free_text(60, 70, 1600, 24,
          "Source: docs/plans/shop-guard-v2.md §2  ·  Commit anchor: dc978b4 (Stage 0)  ·  Generated 2026-05-19",
          font_size=12, color="#5a6b7e", align="left", font_family=2)

# -------- Group outlines (rendered first so boxes sit on top) --------
GROUP_TOP = 130
GROUP_BOTTOM = 880

def group(id, col_key, label, top=GROUP_TOP, bottom=GROUP_BOTTOM):
    x = COL_X[col_key]
    rect(id, x, top, COL_W, bottom - top,
         fill=GROUP_FILL, stroke=GROUP_STROKE,
         stroke_style="solid", stroke_width=1, rounded=True, text=None)
    free_text(x + 16, top + 12, COL_W - 32, 20, label,
              font_size=13, color=GROUP_STROKE, align="left", font_family=2)

group("g-input",  "input",  "Inputs (entry surfaces)")
group("g-route",  "route",  "Routing (analyze spine)")
group("g-module", "module", "shop-signal Module")
group("g-stage1", "stage1", "Stage 1+ enrichments (gated)")
group("g-output", "output", "Output Adapters")

# -------- Column 1: Inputs (8 boxes) --------
inputs = [
    ("i-web",       "Web drawer\nScamChecker.tsx",                              "stage0"),
    ("i-mobile",    "Mobile share-target\napp/share-target/route.ts",          "stage0"),
    ("i-telegram",  "Telegram bot",                                             "stage0"),
    ("i-whatsapp",  "WhatsApp bot",                                             "stage0"),
    ("i-slack",     "Slack bot",                                                "stage0"),
    ("i-messenger", "Messenger bot",                                            "stage0"),
    ("i-extension", "Browser extension\n[Stage 2]",                             "stage2"),
    ("i-b2b",       "B2B /api/v1/shop-check\n[Stage 2]",                        "stage2"),
]

INPUT_TOP = 170
INPUT_GAP = 84

input_y_by_id = {}
for idx, (eid, text, stage) in enumerate(inputs):
    y = INPUT_TOP + idx * INPUT_GAP
    fill = STAGE0_FILL if stage == "stage0" else STAGE2_FILL
    stroke = STAGE0_STROKE if stage == "stage0" else STAGE2_STROKE
    stroke_style = "solid" if stage == "stage0" else "dashed"
    rect(eid, BOX_X["input"], y, BOX_W, BOX_H,
         fill=fill, stroke=stroke, stroke_style=stroke_style, text=text, font_size=12)
    input_y_by_id[eid] = y

# -------- Column 2: Routing (3 boxes) --------
routes = [
    ("r-api",     "/api/analyze route\napp/api/analyze/route.ts"),
    ("r-core",    "runAnalysisCore\nscam-engine/analyze-core.ts"),
    ("r-bot",     "analyzeForBot\nbot-core/analyze.ts"),
]
ROUTE_TOP = 230
ROUTE_GAP = 220
route_y_by_id = {}
for idx, (eid, text) in enumerate(routes):
    y = ROUTE_TOP + idx * ROUTE_GAP
    rect(eid, BOX_X["route"], y, BOX_W, BOX_H,
         fill=STAGE0_FILL, stroke=STAGE0_STROKE, text=text, font_size=12)
    route_y_by_id[eid] = y

# -------- Column 3: Module (3 boxes vertically) --------
module_boxes = [
    ("m-detect",  "detectCommerceSignal()\nURL TLD + path + platform\nOR text commerce verbs"),
    ("m-extract", "extractCommerceFlags()\nfilter redFlags → tags"),
    ("m-build",   "buildShopSignal()\n{ isCommerce,\n  commerceFlags,\n  generatedAt }"),
]
MOD_TOP = 220
MOD_GAP = 130
MOD_BOX_H = 90
module_y_by_id = {}
for idx, (eid, text) in enumerate(module_boxes):
    y = MOD_TOP + idx * MOD_GAP
    rect(eid, BOX_X["module"], y, BOX_W, MOD_BOX_H,
         fill=STAGE0_FILL, stroke=STAGE0_STROKE, stroke_width=3, text=text, font_size=12)
    module_y_by_id[eid] = y

# Vertical module-internal arrows
arrow("ma-1",
      BOX_X["module"] + BOX_W / 2, module_y_by_id["m-detect"] + MOD_BOX_H,
      BOX_X["module"] + BOX_W / 2, module_y_by_id["m-extract"],
      stroke=STAGE0_STROKE)
arrow("ma-2",
      BOX_X["module"] + BOX_W / 2, module_y_by_id["m-extract"] + MOD_BOX_H,
      BOX_X["module"] + BOX_W / 2, module_y_by_id["m-build"],
      stroke=STAGE0_STROKE)

# -------- Column 4: Stage 1+ enrichments (3 boxes) --------
stage1_boxes = [
    ("s-apivoid", "APIVoid Adapter\n~A$0.003/call\nSHOP_SIGNAL_CAP_USD=15"),
    ("s-inngest", "Inngest fan-out\nshop.signal.evaluated.v1"),
    ("s-table",   "shop_checks table\nverdict TEXT + CHECK\nhot ⚠  ·  90d TTL"),
]
S1_TOP = 220
S1_GAP = 130
S1_BOX_H = 90
s1_y_by_id = {}
for idx, (eid, text) in enumerate(stage1_boxes):
    y = S1_TOP + idx * S1_GAP
    rect(eid, BOX_X["stage1"], y, BOX_W, S1_BOX_H,
         fill=STAGE1_FILL, stroke=STAGE1_STROKE, stroke_style="dashed",
         stroke_width=2, text=text, font_size=12)
    s1_y_by_id[eid] = y

# Stage 1 internal chain: APIVoid → Inngest → shop_checks
arrow("sa-1",
      BOX_X["stage1"] + BOX_W / 2, s1_y_by_id["s-apivoid"] + S1_BOX_H,
      BOX_X["stage1"] + BOX_W / 2, s1_y_by_id["s-inngest"],
      stroke=STAGE1_STROKE, stroke_style="dashed")
arrow("sa-2",
      BOX_X["stage1"] + BOX_W / 2, s1_y_by_id["s-inngest"] + S1_BOX_H,
      BOX_X["stage1"] + BOX_W / 2, s1_y_by_id["s-table"],
      stroke=STAGE1_STROKE, stroke_style="dashed")

# -------- Column 5: Output adapters (4 boxes) --------
outputs = [
    ("o-web",      "Web ResultCard\ncommerce-flag chips\n(+ accordion at Stage 1)", "stage0"),
    ("o-bot",      "Bot formatters ×4\nsingle-line summary",                          "stage0"),
    ("o-ext",      "Extension popup\nactiveTab only\n[Stage 2]",                      "stage2"),
    ("o-b2b",      "B2B JSON response\n+ onward_report_log\n[Stage 2]",               "stage2"),
]
OUT_TOP = 200
OUT_GAP = 170
OUT_BOX_H = 90
out_y_by_id = {}
for idx, (eid, text, stage) in enumerate(outputs):
    y = OUT_TOP + idx * OUT_GAP
    fill = STAGE0_FILL if stage == "stage0" else STAGE2_FILL
    stroke = STAGE0_STROKE if stage == "stage0" else STAGE2_STROKE
    style = "solid" if stage == "stage0" else "dashed"
    rect(eid, BOX_X["output"], y, BOX_W, OUT_BOX_H,
         fill=fill, stroke=stroke, stroke_style=style, text=text, font_size=12)
    out_y_by_id[eid] = y

# -------- Cross-column arrows --------
# Helper to get right-edge midpoint of a box and left-edge midpoint of another
def right_mid(col, y, h=BOX_H):
    return (BOX_X[col] + BOX_W, y + h / 2)

def left_mid(col, y, h=BOX_H):
    return (BOX_X[col], y + h / 2)

# Inputs → Routing
# Web drawer → /api/analyze (solid)
p0 = right_mid("input", input_y_by_id["i-web"])
p1 = left_mid("route", route_y_by_id["r-api"])
arrow("a-web-api", p0[0], p0[1], p1[0], p1[1], stroke=STAGE0_STROKE)

# Mobile → web drawer (dashed, label "shared_text +")
p0 = right_mid("input", input_y_by_id["i-mobile"])
p1 = (BOX_X["input"] + BOX_W + 30, input_y_by_id["i-web"] + BOX_H / 2)
# Down-then-left would be elbowed; simpler: short arrow back up to web
arrow("a-mobile-web", p0[0], p0[1], p1[0], p1[1] + 6,
      stroke=STAGE1_STROKE, stroke_style="dashed",
      label="shared_text +  (today)")

# Mobile → /api/analyze (dashed amber, Stage 0.5 label)
p0 = right_mid("input", input_y_by_id["i-mobile"])
p1 = left_mid("route", route_y_by_id["r-api"])
arrow("a-mobile-api", p0[0], p0[1] + 6, p1[0], p1[1] + 30,
      stroke=STAGE1_STROKE, stroke_style="dashed",
      label="Stage 0.5: Referer + X-AskArthur-Inapp-Source")

# Bots → analyzeForBot (solid)
for bot_id in ("i-telegram", "i-whatsapp", "i-slack", "i-messenger"):
    p0 = right_mid("input", input_y_by_id[bot_id])
    p1 = left_mid("route", route_y_by_id["r-bot"])
    arrow(f"a-{bot_id}-bot", p0[0], p0[1], p1[0], p1[1], stroke=STAGE0_STROKE)

# Extension → /api/analyze (dashed orange, Stage 2)
p0 = right_mid("input", input_y_by_id["i-extension"])
p1 = left_mid("route", route_y_by_id["r-api"])
arrow("a-ext-api", p0[0], p0[1], p1[0], p1[1] - 14,
      stroke=STAGE2_STROKE, stroke_style="dashed",
      label="Stage 2")

# B2B → runAnalysisCore (dashed orange, Stage 2)
p0 = right_mid("input", input_y_by_id["i-b2b"])
p1 = left_mid("route", route_y_by_id["r-core"])
arrow("a-b2b-core", p0[0], p0[1], p1[0], p1[1],
      stroke=STAGE2_STROKE, stroke_style="dashed",
      label="Stage 2")

# Routing → Module
# /api/analyze → detectCommerceSignal (solid)
p0 = right_mid("route", route_y_by_id["r-api"])
p1 = left_mid("module", module_y_by_id["m-detect"], h=MOD_BOX_H)
arrow("a-api-mod", p0[0], p0[1], p1[0], p1[1], stroke=STAGE0_STROKE)

# runAnalysisCore → detectCommerceSignal (solid)
p0 = right_mid("route", route_y_by_id["r-core"])
p1 = left_mid("module", module_y_by_id["m-detect"], h=MOD_BOX_H)
arrow("a-core-mod", p0[0], p0[1], p1[0], p1[1], stroke=STAGE0_STROKE)

# analyzeForBot → runAnalysisCore (solid, intra-column)
p0 = (BOX_X["route"] + BOX_W / 2, route_y_by_id["r-bot"])
p1 = (BOX_X["route"] + BOX_W / 2, route_y_by_id["r-core"] + BOX_H)
arrow("a-bot-core", p0[0], p0[1], p1[0], p1[1], stroke=STAGE0_STROKE)

# Module → Outputs (from buildShopSignal)
build_y = module_y_by_id["m-build"]
p0 = right_mid("module", build_y, h=MOD_BOX_H)

# buildShopSignal → APIVoid (dashed amber, Stage 1) — goes through stage1 column
p1 = left_mid("stage1", s1_y_by_id["s-apivoid"], h=S1_BOX_H)
arrow("a-build-apivoid", p0[0], p0[1] - 30, p1[0], p1[1],
      stroke=STAGE1_STROKE, stroke_style="dashed", label="Stage 1")

# buildShopSignal → Web ResultCard (solid)
p1 = left_mid("output", out_y_by_id["o-web"], h=OUT_BOX_H)
arrow("a-build-web", p0[0], p0[1], p1[0], p1[1], stroke=STAGE0_STROKE)

# buildShopSignal → Bot formatters (solid)
p1 = left_mid("output", out_y_by_id["o-bot"], h=OUT_BOX_H)
arrow("a-build-bots", p0[0], p0[1] + 14, p1[0], p1[1], stroke=STAGE0_STROKE)

# buildShopSignal → Extension popup (dashed orange, Stage 2)
p1 = left_mid("output", out_y_by_id["o-ext"], h=OUT_BOX_H)
arrow("a-build-ext", p0[0], p0[1] + 24, p1[0], p1[1],
      stroke=STAGE2_STROKE, stroke_style="dashed", label="Stage 2")

# buildShopSignal → B2B JSON (dashed orange, Stage 2)
p1 = left_mid("output", out_y_by_id["o-b2b"], h=OUT_BOX_H)
arrow("a-build-b2b", p0[0], p0[1] + 34, p1[0], p1[1],
      stroke=STAGE2_STROKE, stroke_style="dashed", label="Stage 2")

# shop_checks → Web ResultCard (dashed amber, hydrate)
p0 = right_mid("stage1", s1_y_by_id["s-table"], h=S1_BOX_H)
p1 = left_mid("output", out_y_by_id["o-web"], h=OUT_BOX_H)
arrow("a-table-web", p0[0], p0[1], p1[0], p1[1] + 30,
      stroke=STAGE1_STROKE, stroke_style="dashed",
      label="hydrate accordion (Stage 1)")

# shop_checks → Extension (dashed orange, Stage 2)
p1 = left_mid("output", out_y_by_id["o-ext"], h=OUT_BOX_H)
arrow("a-table-ext", p0[0], p0[1] + 10, p1[0], p1[1],
      stroke=STAGE2_STROKE, stroke_style="dashed", label="Stage 2")

# shop_checks → B2B (dashed orange, Stage 2)
p1 = left_mid("output", out_y_by_id["o-b2b"], h=OUT_BOX_H)
arrow("a-table-b2b", p0[0], p0[1] + 20, p1[0], p1[1],
      stroke=STAGE2_STROKE, stroke_style="dashed", label="Stage 2")

# -------- Legend (bottom-left) --------
LEGEND_X = 60
LEGEND_Y = 920
LEGEND_BOX = 24
free_text(LEGEND_X, LEGEND_Y, 200, 22, "Legend",
          font_size=15, color=TITLE_COLOR, align="left", font_family=2)

# Stage 0 swatch
rect("l-s0", LEGEND_X, LEGEND_Y + 36, LEGEND_BOX, LEGEND_BOX,
     fill=STAGE0_FILL, stroke=STAGE0_STROKE, rounded=False, text=None)
free_text(LEGEND_X + 36, LEGEND_Y + 39, 500, 24,
          "Stage 0 — shipped (commit dc978b4)",
          font_size=13, color=TEXT, align="left", font_family=2)

# Stage 1 swatch
rect("l-s1", LEGEND_X, LEGEND_Y + 72, LEGEND_BOX, LEGEND_BOX,
     fill=STAGE1_FILL, stroke=STAGE1_STROKE, stroke_style="dashed", rounded=False, text=None)
free_text(LEGEND_X + 36, LEGEND_Y + 75, 500, 24,
          "Stage 0.5 / Stage 1 — planned, gated on Stage-0 measurement",
          font_size=13, color=TEXT, align="left", font_family=2)

# Stage 2 swatch
rect("l-s2", LEGEND_X, LEGEND_Y + 108, LEGEND_BOX, LEGEND_BOX,
     fill=STAGE2_FILL, stroke=STAGE2_STROKE, stroke_style="dashed", rounded=False, text=None)
free_text(LEGEND_X + 36, LEGEND_Y + 111, 600, 24,
          "Stage 2 — extension popup + B2B, gated on Stage-1 measurement",
          font_size=13, color=TEXT, align="left", font_family=2)

# Diagram contract block (right of legend)
CONTRACT_X = 700
free_text(CONTRACT_X, LEGEND_Y, 1000, 22, "Contract this diagram encodes",
          font_size=15, color=TITLE_COLOR, align="left", font_family=2)
contract_lines = [
    "1. shop-signal lives in packages/scam-engine/ — never a sibling package.",
    "2. Every Adapter consumes AnalysisResult.shopSignal — none reach around the Module.",
    "3. Two analyze entry points (web /api/analyze + runAnalysisCore) call the Module directly; bots reach it via runAnalysisCore.",
    "4. APIVoid + shop_checks + Inngest are Stage 1 — Stage 0 must not write DB, call a paid API, or emit Inngest.",
    "5. Extension popup is activeTab at Stage 2; <all_urls> is a separate PR gated on activation data.",
]
for i, line in enumerate(contract_lines):
    free_text(CONTRACT_X, LEGEND_Y + 36 + i * 22, 1100, 22, line,
              font_size=12, color=TEXT, align="left", font_family=2)

# -------- Document --------
doc = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {
        "viewBackgroundColor": "#ffffff",
        "gridSize": None,
    },
    "files": {},
}

out_path = "/Users/brendanmilton/Desktop/safeverify/docs/plans/assets/shop-signal-architecture.excalidraw"
with open(out_path, "w") as f:
    json.dump(doc, f, indent=2)

print(f"wrote {out_path}  ({len(elements)} elements)")

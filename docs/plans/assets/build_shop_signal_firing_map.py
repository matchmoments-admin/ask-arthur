#!/usr/bin/env python3
"""Build the Shop Signal Deep Check *integration firing map* as Excalidraw JSON.

Generated artifact — edit THIS script, not the .excalidraw, then re-run:

    python3 docs/plans/assets/build_shop_signal_firing_map.py
    python3 ~/.claude/skills/excalidraw-diagram/render_diagram.py \
        docs/plans/assets/shop-signal-integration-firing-map.excalidraw

Pattern: linear-flow lifecycle ribbon + 4 comparison columns (one per
external call). Palette: ask-arthur. See ~/.claude/skills/excalidraw-diagram.
"""

import json
import os

# ── ask-arthur palette (color_palette.json) ──────────────────────────────
BG = "#ffffff"
SURFACE = "#f8fafc"
PRIMARY = "#001f3f"
ACCENT = "#008a98"
MUTED = "#42526e"
TEXT = "#171717"
WARN = "#e65100"
WARN_BG = "#fff8e1"
DANGER = "#b71c1c"
DANGER_BG = "#fef2f2"
BORDER = "#e2e8f0"
WHITE = "#ffffff"

elements = []
_seed = [4000]


def _s():
    _seed[0] += 1
    return _seed[0]


def _base(eid, typ, x, y, w, h, stroke, fill, fill_style, sw, ss, roundness):
    return {
        "id": eid, "type": typ, "x": x, "y": y, "width": w, "height": h,
        "angle": 0, "strokeColor": stroke, "backgroundColor": fill,
        "fillStyle": fill_style, "strokeWidth": sw, "strokeStyle": ss,
        "roughness": 1, "opacity": 100, "groupIds": [], "frameId": None,
        "roundness": roundness, "seed": _s(), "version": 1,
        "versionNonce": _s(), "isDeleted": False, "boundElements": [],
        "updated": 1, "link": None, "locked": False,
    }


def rect(eid, x, y, w, h, stroke, fill="transparent", sw=2, ss="solid",
         rounded=True):
    e = _base(eid, "rectangle", x, y, w, h, stroke, fill, "solid", sw, ss,
              {"type": 3} if rounded else None)
    elements.append(e)
    return e


def text(eid, x, y, s, size, color, align="left", maxw=None, family=1):
    lines = s.split("\n")
    longest = max(len(l) for l in lines)
    w = maxw if maxw else int(0.62 * size * longest) + 8
    h = int(size * len(lines) * 1.25) + 4
    e = _base(eid, "text", x, y, w, h, color, "transparent", "solid", 2,
              "solid", None)
    e.update({
        "text": s, "originalText": s, "fontSize": size, "fontFamily": family,
        "textAlign": align, "verticalAlign": "top", "containerId": None,
        "lineHeight": 1.25, "baseline": int(size * 0.8),
    })
    elements.append(e)
    return e


def boxtext(eid, bx, by, bw, bh, s, size, color):
    """Center a (possibly multi-line) label inside a box."""
    th = int(size * len(s.split("\n")) * 1.25)
    text(eid, bx + 6, by + (bh - th) // 2, s, size, color, align="center",
         maxw=bw - 12)


def arrow(eid, x1, y1, x2, y2, color, sw=2, ss="solid", endhead="arrow"):
    e = _base(eid, "arrow", x1, y1, abs(x2 - x1), abs(y2 - y1), color,
              "transparent", "solid", sw, ss, None)
    e.update({
        "points": [[0, 0], [x2 - x1, y2 - y1]], "lastCommittedPoint": None,
        "startBinding": None, "endBinding": None, "startArrowhead": None,
        "endArrowhead": endhead, "elbowed": False,
    })
    elements.append(e)
    return e


def line(eid, x1, y1, x2, y2, color, sw=2):
    e = _base(eid, "line", x1, y1, abs(x2 - x1), abs(y2 - y1), color,
              "transparent", "solid", sw, "solid", None)
    e.update({
        "points": [[0, 0], [x2 - x1, y2 - y1]], "lastCommittedPoint": None,
        "startBinding": None, "endBinding": None, "startArrowhead": None,
        "endArrowhead": None, "elbowed": False,
    })
    elements.append(e)
    return e


# ── Title ────────────────────────────────────────────────────────────────
text("title", 60, 28,
     "Shop Signal — Deep Shop Check: integration firing map", 28, PRIMARY)
text("subtitle", 60, 72,
     "Every external call the enrichment makes, in firing order — when it "
     "fires, what it does, what it costs, and known issues.", 14, MUTED)

# ── Lifecycle ribbon (linear flow) ───────────────────────────────────────
RIB_Y, RIB_H, RIB_W, RIB_STEP = 120, 68, 200, 236
ribbon = [
    ('User clicks\n"Run a deeper shop check"', False),
    ("POST /api/shop-check\ngate · validate · rate-limit", False),
    ("upsert_shop_check\n→ new shop_checks row", False),
    ("emit\nshop.check.requested.v1", False),
    ("shop-signal-enrich\nInngest function", True),
    ("score + write-back\nupdate_shop_check_signal", False),
    ("GET poll →\nDeepShopCheckTray", False),
]
for i, (label, hot) in enumerate(ribbon):
    bx = 60 + RIB_STEP * i
    rect(f"rib{i}", bx, RIB_Y, RIB_W, RIB_H,
         ACCENT if hot else PRIMARY, ACCENT if hot else SURFACE)
    boxtext(f"ribt{i}", bx, RIB_Y, RIB_W, RIB_H, label, 12,
            WHITE if hot else PRIMARY)
for i in range(6):
    x1 = 60 + RIB_STEP * i + RIB_W
    x2 = 60 + RIB_STEP * (i + 1)
    arrow(f"riba{i}", x1 + 3, RIB_Y + RIB_H // 2, x2 - 3, RIB_Y + RIB_H // 2,
          ACCENT)

# ── Connector: enrich box → integration cards ────────────────────────────
ENRICH_CX = 60 + RIB_STEP * 4 + RIB_W // 2          # centre of ribbon box 5
DIST_Y = 250
arrow("down", ENRICH_CX, RIB_Y + RIB_H + 2, ENRICH_CX, DIST_Y, ACCENT, sw=3)
text("distlbl", 110, 224,
     "shop-signal-enrich — the four external calls fire in this order:",
     12, MUTED)

CARD_W, CARD_GAP, CARD_Y, CARD_H = 360, 50, 384, 484
card_x = [60 + (CARD_W + CARD_GAP) * i for i in range(4)]
card_cx = [x + CARD_W // 2 for x in card_x]
line("dist", card_cx[0], DIST_Y, card_cx[3], DIST_Y, ACCENT)
for j, cx in enumerate(card_cx):
    arrow(f"stub{j}", cx, DIST_Y + 2, cx, CARD_Y - 6, ACCENT)

# ── Integration cards (comparison columns) ───────────────────────────────
cards = [
    {
        "title": "1 · Shop page fetch",
        "sub": "verify-abn step  ·  GET the shop URL",
        "hdr": MUTED,
        "zones": [
            ("FIRES WHEN",
             "Every deep check — the first\naction inside the verify-abn step."),
            ("WHAT IT DOES",
             "HTTP GET of the shop homepage so\nthe HTML can be scanned for an "
             "ABN.\nManual redirects · 6s · 512KB cap."),
            ("COST", "$0 — no API key, no cache."),
        ],
        "issue": ("MINOR-2  (UX)",
                  "An unfetchable page makes\n"
                  'verifyShopAbn("") assert "no-abn" —\n'
                  "a claim the system can't support.", "warn"),
    },
    {
        "title": "2 · ABR register",
        "sub": "verify-abn step  ·  abr.business.gov.au",
        "hdr": ACCENT,
        "zones": [
            ("FIRES WHEN",
             ".au host AND a checksum-valid\nABN was found in the page HTML."),
            ("WHAT IT DOES",
             "Verifies the ABN on the national\nregister; returns the entity "
             "name\nfor the brand-name match."),
            ("COST", "$0 — free .gov API.\nRedis-cached 24h per ABN."),
        ],
        "issue": ("F-A  (correctness, MEDIUM)",
                  "A lookup FAILURE returns null,\n"
                  'scored as "unregistered" (+30) —\n'
                  "false-flags a legitimate AU shop.", "danger"),
    },
    {
        "title": "3 · WHOIS",
        "sub": "domain-age step  ·  whoisjson.com",
        "hdr": ACCENT,
        "zones": [
            ("FIRES WHEN",
             "Every deep check — but only on a\n"
             "scam_urls cache miss / >180d stale."),
            ("WHAT IT DOES",
             "Resolves the domain registration\ndate → fresh / recent /\n"
             "established / unknown age band."),
            ("COST",
             "$0 — free tier ~1,000/mo,\nnear-exhausted (so: cache-first)."),
        ],
        "issue": ("F-G  +  .au coverage gap",
                  'Always "unknown" for .au domains\n'
                  "(auDA restricts WHOIS). F-G: the\n"
                  "write-back is fire-and-forget.", "warn"),
    },
    {
        "title": "4 · APIVoid",
        "sub": "apivoid step  ·  api.apivoid.com",
        "hdr": ACCENT,
        "zones": [
            ("FIRES WHEN",
             "Every deep check — only if\nFF_SHOP_SIGNAL_PAID_FEED is ON\n"
             "and the cost brake is clear."),
            ("WHAT IT DOES",
             "Site Trustworthiness: trust score\n+ blacklist + security checks "
             "→\nsafe / suspicious / risky."),
            ("COST",
             "~$0.0033 / call (10 credits).\nLogged even on the free trial."),
        ],
        "issue": ("F-B  (telemetry, LOW)",
                  "A brake-engaged skip is logged\n"
                  'as "apivoid-error" — looks like\n'
                  "a failure in the health digest.", "warn"),
    },
]

HDR_H = 58
ZONE_H = 98
for j, c in enumerate(cards):
    x = card_x[j]
    rect(f"card{j}", x, CARD_Y, CARD_W, CARD_H, BORDER, WHITE)
    rect(f"hdr{j}", x, CARD_Y, CARD_W, HDR_H, c["hdr"], c["hdr"])
    text(f"hdrt{j}", x + 20, CARD_Y + 9, c["title"], 17, WHITE)
    text(f"hdrs{j}", x + 20, CARD_Y + 34, c["sub"], 11, "#e8f3f4")

    body_top = CARD_Y + HDR_H + 16
    for k, (zlabel, zbody) in enumerate(c["zones"]):
        zt = body_top + k * ZONE_H
        text(f"zl{j}_{k}", x + 22, zt, zlabel, 11, ACCENT)
        text(f"zb{j}_{k}", x + 22, zt + 19, zbody, 12, TEXT, maxw=CARD_W - 44)

    # ISSUE zone — tinted card region.
    zt = body_top + 3 * ZONE_H
    ilabel, ibody, sev = c["issue"]
    tint_bg = DANGER_BG if sev == "danger" else WARN_BG
    tint_stroke = DANGER if sev == "danger" else WARN
    rect(f"itint{j}", x + 12, zt - 8, CARD_W - 24, 96, tint_stroke, tint_bg,
         sw=2)
    text(f"il{j}", x + 22, zt, ilabel, 11, tint_stroke)
    text(f"ib{j}", x + 22, zt + 19, ibody, 12, TEXT, maxw=CARD_W - 48)

# ── Footnote ─────────────────────────────────────────────────────────────
text("foot", 60, 900,
     "Known issues — F-A (correctness) · F-B / F-G (low) · MINOR-2 (UX). "
     "Tracked on GitHub issue #349.\n"
     "Full firing table, guard cheat-sheet and cost derivation: "
     "docs/ops/shop-signal-config.md §6.", 12, MUTED)

# ── Emit ─────────────────────────────────────────────────────────────────
doc = {
    "type": "excalidraw",
    "version": 2,
    "source": "https://excalidraw.com",
    "elements": elements,
    "appState": {"viewBackgroundColor": BG, "gridSize": None},
    "files": {},
}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "shop-signal-integration-firing-map.excalidraw")
with open(out, "w") as f:
    json.dump(doc, f, indent=2)
print(f"wrote {out}  ({len(elements)} elements)")

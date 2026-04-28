#!/usr/bin/env python3
"""
Generate 3 excalidraw diagrams to replace the mermaid blocks in
docs/blog/how-ask-arthur-works.md.

Reuses the same Pillow-renderable layout primitives as the SPF builder,
with the warm-editorial palette (matches the post's existing brand-warm
hero illustration).
"""

import json
import time
from pathlib import Path

OUT_DIR = Path(
    "/Users/brendanmilton/Desktop/safeverify/docs/blog/diagrams/how-ask-arthur-works"
)
OUT_DIR.mkdir(exist_ok=True, parents=True)

# Warm editorial palette — matches blog-architecture-hero-v1.webp
PAL = {
    "bg": "#FAF6EF",                  # cream off-white background
    "primary": "#001F3F",             # deep navy linework
    "terracotta": "#C1614A",          # warm secondary accent
    "ochre": "#D9A441",               # mustard highlight
    "peach": "#F4C9B8",               # soft skin/secondary fill
    "sage": "#7A8B5C",                # tertiary
    "muted": "#5A6B7E",               # caption / secondary text
    "text": "#001F3F",                # body text uses navy
    "danger_dim": "#B8473A",          # used sparingly
}

_seed = [2000]


def next_seed():
    _seed[0] += 1
    return _seed[0]


def now_ms():
    return int(time.time() * 1000)


def common(el_id, el_type, x, y, w, h, **overrides):
    base = {
        "id": el_id,
        "type": el_type,
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "angle": 0,
        "strokeColor": "#1e1e1e",
        "backgroundColor": "transparent",
        "fillStyle": "solid",
        "strokeWidth": 2,
        "strokeStyle": "solid",
        "roughness": 1,
        "opacity": 100,
        "groupIds": [],
        "frameId": None,
        "roundness": None,
        "seed": next_seed(),
        "version": 1,
        "versionNonce": next_seed() * 7,
        "isDeleted": False,
        "boundElements": None,
        "updated": now_ms(),
        "link": None,
        "locked": False,
    }
    base.update(overrides)
    return base


def rect(el_id, x, y, w, h, *, stroke=None, fill=None, sw=2, rounded=True):
    return common(
        el_id, "rectangle", x, y, w, h,
        strokeColor=stroke or PAL["primary"],
        backgroundColor=fill or "transparent",
        strokeWidth=sw,
        roundness={"type": 3} if rounded else None,
    )


def text(el_id, x, y, w, h, content, *, size=18, color=None, align="center", valign="middle", family=1):
    return common(
        el_id, "text", x, y, w, h,
        strokeColor=color or PAL["text"],
        text=content, originalText=content,
        fontSize=size, fontFamily=family,
        textAlign=align, verticalAlign=valign,
        containerId=None, lineHeight=1.25,
        baseline=int(size * 0.85),
    )


def arrow(el_id, fx, fy, tx, ty, *, color=None, sw=2, end_head="arrow", label=None):
    width = abs(tx - fx)
    height = abs(ty - fy)
    el = common(el_id, "arrow", fx, fy, width, height,
                strokeColor=color or PAL["primary"], strokeWidth=sw)
    el.update({
        "points": [[0, 0], [tx - fx, ty - fy]],
        "lastCommittedPoint": None,
        "startBinding": None, "endBinding": None,
        "startArrowhead": None, "endArrowhead": end_head,
        "elbowed": False,
    })
    return el


def write_doc(filename, elements, bg=None):
    doc = {
        "type": "excalidraw", "version": 2, "source": "https://excalidraw.com",
        "elements": elements,
        "appState": {"viewBackgroundColor": bg or PAL["bg"], "gridSize": None},
        "files": {},
    }
    out = OUT_DIR / filename
    out.write_text(json.dumps(doc, indent=2))
    print(f"  wrote {out}")
    return out


# ============================================================================
# DIAGRAM 1 — System Context (replaces C4Context mermaid)
# ============================================================================

def build_system_context():
    print("\n→ System Context")
    els = []

    els.append(text("title", 60, 40, 1500, 40,
                   "System Context — Ask Arthur",
                   size=28, color=PAL["primary"], align="left", valign="top"))
    els.append(text("subtitle", 60, 84, 1500, 22,
                   "Two user types, one platform, eight external systems.",
                   size=14, color=PAL["muted"], align="left", valign="top"))

    # User pills (top-left and top-right)
    USER_W, USER_H = 220, 80
    USER_Y = 150

    # Consumer user (left)
    els.append(rect("user-consumer", 60, USER_Y, USER_W, USER_H,
                   stroke=PAL["primary"], fill=PAL["peach"], sw=2))
    els.append(text("user-consumer-l", 60, USER_Y + 8, USER_W, 20, "Consumer user",
                   size=15, color=PAL["primary"], valign="top"))
    els.append(text("user-consumer-d", 60, USER_Y + 32, USER_W, 44,
                   "Submits suspicious content\nvia web, extension, mobile, bot",
                   size=11, color=PAL["text"], valign="top"))

    # Business customer (right)
    els.append(rect("user-biz", 60 + USER_W + 1100, USER_Y, USER_W, USER_H,
                   stroke=PAL["primary"], fill=PAL["peach"], sw=2))
    els.append(text("user-biz-l", 60 + USER_W + 1100, USER_Y + 8, USER_W, 20, "Business customer",
                   size=15, color=PAL["primary"], valign="top"))
    els.append(text("user-biz-d", 60 + USER_W + 1100, USER_Y + 32, USER_W, 44,
                   "Queries threat data\nvia signed API",
                   size=11, color=PAL["text"], valign="top"))

    # Central platform box (large, prominent)
    PLAT_W, PLAT_H = 400, 120
    PLAT_X = 60 + 1580 / 2 - PLAT_W / 2 - 30  # center-ish
    PLAT_Y = USER_Y + USER_H + 80
    els.append(rect("platform", PLAT_X, PLAT_Y, PLAT_W, PLAT_H,
                   stroke=PAL["primary"], fill=PAL["ochre"], sw=4))
    els.append(text("platform-l", PLAT_X, PLAT_Y + 16, PLAT_W, 32,
                   "Ask Arthur",
                   size=28, color=PAL["primary"], valign="top"))
    els.append(text("platform-d", PLAT_X, PLAT_Y + 56, PLAT_W, 50,
                   "Australian scam-detection platform\nseven consumer surfaces · six B2B API endpoints",
                   size=13, color=PAL["primary"], valign="top"))

    # User → Platform arrows
    plat_top_y = PLAT_Y
    els.append(arrow("a-user-plat", 60 + USER_W / 2, USER_Y + USER_H,
                    PLAT_X + PLAT_W * 0.30, plat_top_y, color=PAL["terracotta"], sw=2))
    els.append(arrow("a-biz-plat", 60 + USER_W + 1100 + USER_W / 2, USER_Y + USER_H,
                    PLAT_X + PLAT_W * 0.70, plat_top_y, color=PAL["terracotta"], sw=2))
    els.append(text("a-user-plat-l", 270, USER_Y + USER_H + 18, 200, 18,
                   "Submits content (HTTPS)", size=11, color=PAL["muted"], align="left"))
    els.append(text("a-biz-plat-l", 1090, USER_Y + USER_H + 18, 220, 18,
                   "Threat queries (Bearer REST)", size=11, color=PAL["muted"], align="right"))

    # External systems — 8 boxes in a 4×2 grid below the platform
    EXT_Y = PLAT_Y + PLAT_H + 100
    EXT_W, EXT_H = 320, 80
    EXT_GAP_X, EXT_GAP_Y = 40, 40
    GRID_COLS = 4
    GRID_TOTAL_W = GRID_COLS * EXT_W + (GRID_COLS - 1) * EXT_GAP_X
    GRID_X0 = 60 + (1580 - GRID_TOTAL_W) / 2

    externals = [
        ("Claude Haiku 4.5", "Anthropic — AI classification", PAL["sage"]),
        ("Google Safe Browsing", "URL reputation", PAL["sage"]),
        ("Twilio Lookup v2", "Phone line-type + carrier", PAL["sage"]),
        ("Supabase", "Managed Postgres + auth + storage", PAL["sage"]),
        ("Upstash Redis", "Cache and rate limit", PAL["sage"]),
        ("Inngest", "Durable background jobs", PAL["sage"]),
        ("Cloudflare R2", "Media and evidence storage", PAL["sage"]),
        ("Threat feeds (16)", "PhishTank, URLhaus, OpenPhish,\nThreatFox, ACCC Scamwatch, +11", PAL["sage"]),
    ]

    for i, (name, desc, color) in enumerate(externals):
        col = i % GRID_COLS
        row = i // GRID_COLS
        ex = GRID_X0 + col * (EXT_W + EXT_GAP_X)
        ey = EXT_Y + row * (EXT_H + EXT_GAP_Y)
        eid = f"ext-{i}"
        els.append(rect(eid, ex, ey, EXT_W, EXT_H, stroke=color, fill=PAL["bg"], sw=2))
        els.append(text(f"{eid}-l", ex + 12, ey + 8, EXT_W - 24, 22, name,
                       size=15, color=color, align="left", valign="top"))
        els.append(text(f"{eid}-d", ex + 12, ey + 32, EXT_W - 24, 40, desc,
                       size=11, color=PAL["text"], align="left", valign="top"))

        # Arrow from platform to each external
        # Platform bottom center → external top center
        plat_bottom_x = PLAT_X + PLAT_W / 2
        plat_bottom_y = PLAT_Y + PLAT_H
        ext_top_x = ex + EXT_W / 2
        ext_top_y = ey
        # Threat feeds (last entry) flows the OTHER direction
        if name.startswith("Threat feeds"):
            els.append(arrow(f"a-{i}", ext_top_x, ext_top_y, plat_bottom_x, plat_bottom_y,
                            color=PAL["terracotta"], sw=2))
        else:
            els.append(arrow(f"a-{i}", plat_bottom_x, plat_bottom_y, ext_top_x, ext_top_y,
                            color=PAL["terracotta"], sw=1))

    # Footer caption
    els.append(text("footer", 60, EXT_Y + 2 * (EXT_H + EXT_GAP_Y) + 20, 1500, 22,
                   "All external integrations Australian-hosted where possible (Supabase ap-southeast, Vercel Sydney edge).",
                   size=12, color=PAL["muted"], align="left", valign="top"))

    return write_doc("01-system-context.excalidraw", els)


# ============================================================================
# DIAGRAM 2 — Container View (replaces C4Container mermaid)
# ============================================================================

def build_container_view():
    print("\n→ Container View")
    els = []

    els.append(text("title", 60, 40, 1500, 40,
                   "Container view — Ask Arthur platform",
                   size=28, color=PAL["primary"], align="left", valign="top"))
    els.append(text("subtitle", 60, 84, 1500, 22,
                   "User on the left. Platform boundary in the middle. Upstream APIs on the right.",
                   size=14, color=PAL["muted"], align="left", valign="top"))

    # User pill (far left)
    USER_W, USER_H = 180, 80
    USER_X = 60
    USER_Y = 380
    els.append(rect("user", USER_X, USER_Y, USER_W, USER_H,
                   stroke=PAL["primary"], fill=PAL["peach"], sw=2))
    els.append(text("user-l", USER_X, USER_Y + 28, USER_W, 24, "User",
                   size=20, color=PAL["primary"]))

    # Platform boundary (large outer box) — middle
    PLAT_X = 320
    PLAT_Y = 150
    PLAT_W = 920
    PLAT_H = 620
    els.append(rect("platform-boundary", PLAT_X, PLAT_Y, PLAT_W, PLAT_H,
                   stroke=PAL["primary"], fill=PAL["bg"], sw=4))
    els.append(text("platform-boundary-l", PLAT_X + 16, PLAT_Y + 12, 400, 26,
                   "Ask Arthur (boundary)",
                   size=18, color=PAL["primary"], align="left", valign="top"))

    # Inner containers — 8 boxes in a 4×2 grid inside the platform boundary
    INNER_PAD = 20
    INNER_TOP = PLAT_Y + 56
    CONT_W = 200
    CONT_H = 100
    CONT_GAP = 16
    INNER_W = PLAT_W - 2 * INNER_PAD
    cols = 4
    cont_grid_x = PLAT_X + INNER_PAD + (INNER_W - (cols * CONT_W + (cols - 1) * CONT_GAP)) / 2

    containers = [
        ("Web app", "Next.js 16 + React 19", "askarthur.au, dashboards, submission UI", PAL["terracotta"]),
        ("Browser extension", "WXT + React 19", "Chrome, Firefox — inline page scans", PAL["terracotta"]),
        ("Mobile app", "Expo 54 + RN", "iOS, Android", PAL["terracotta"]),
        ("Chat bots", "Telegram/WA/Slack/Msgr", "Webhook-driven", PAL["terracotta"]),
        ("Scam engine", "TS package", "Claude calls, URL rep, pipeline, Inngest defs", PAL["ochre"]),
        ("Threat pipeline", "Python 3.x", "16 scrapers on GH Actions cron", PAL["ochre"]),
        ("Inngest consumers", "Event-driven + cron", "Enrichment, fan-out, reporting", PAL["ochre"]),
        ("Supabase Postgres", "Managed (DB)", "scam_reports, scam_urls, scam_entities, …", PAL["sage"]),
    ]

    for i, (name, tech, desc, color) in enumerate(containers):
        col = i % cols
        row = i // cols
        cx = cont_grid_x + col * (CONT_W + CONT_GAP)
        cy = INNER_TOP + row * (CONT_H + CONT_GAP * 1.5)
        cid = f"cont-{i}"
        els.append(rect(cid, cx, cy, CONT_W, CONT_H, stroke=color, fill=PAL["bg"], sw=2))
        els.append(text(f"{cid}-l", cx + 8, cy + 6, CONT_W - 16, 18, name,
                       size=13, color=color, align="left", valign="top"))
        els.append(text(f"{cid}-t", cx + 8, cy + 26, CONT_W - 16, 16, tech,
                       size=10, color=PAL["muted"], align="left", valign="top"))
        els.append(text(f"{cid}-d", cx + 8, cy + 44, CONT_W - 16, 50, desc,
                       size=10, color=PAL["text"], align="left", valign="top"))

    # Upstream APIs (far right)
    UP_X = PLAT_X + PLAT_W + 60
    UP_Y = 380
    UP_W = 200
    UP_H = 120
    els.append(rect("upstream", UP_X, UP_Y, UP_W, UP_H,
                   stroke=PAL["primary"], fill=PAL["peach"], sw=2))
    els.append(text("upstream-l", UP_X, UP_Y + 12, UP_W, 24, "Upstream APIs",
                   size=16, color=PAL["primary"], valign="top"))
    els.append(text("upstream-d", UP_X + 8, UP_Y + 44, UP_W - 16, 70,
                   "Claude, Twilio,\nSafe Browsing, URLScan,\nReality Defender …",
                   size=11, color=PAL["text"], align="left", valign="top"))

    # User → first row of containers (the 4 surfaces)
    user_right_x = USER_X + USER_W
    user_mid_y = USER_Y + USER_H / 2
    surface_left_x = cont_grid_x  # container 0 starts here
    surface_y = INNER_TOP + CONT_H / 2  # row 0 vertical center
    els.append(arrow("a-user-1", user_right_x, user_mid_y,
                    surface_left_x, surface_y, color=PAL["terracotta"], sw=2))

    # Engine (cont-4) → upstream
    engine_x = cont_grid_x + 0 * (CONT_W + CONT_GAP)
    engine_right_x = engine_x + CONT_W * 4 + CONT_GAP * 3  # right edge of last col, but use cont-4 specifically
    # cont-4 is row 1 col 0
    eng_x = cont_grid_x + CONT_W
    eng_y = INNER_TOP + CONT_H + CONT_GAP * 1.5 + CONT_H / 2
    els.append(arrow("a-eng-up", PLAT_X + PLAT_W, eng_y,
                    UP_X, UP_Y + UP_H / 2, color=PAL["terracotta"], sw=2))

    # Footer
    els.append(text("footer", 60, PLAT_Y + PLAT_H + 30, 1500, 40,
                   "Surfaces (red): consumer-facing. Engine + pipeline + jobs (ochre): backend logic. Database (green): persistence layer.\nThree internal layers, eight containers total. Diagram simplifies inter-container arrows for readability.",
                   size=11, color=PAL["muted"], align="left", valign="top"))

    return write_doc("02-container-view.excalidraw", els)


# ============================================================================
# DIAGRAM 3 — analyze.completed.v1 fan-out (replaces flowchart LR mermaid)
# ============================================================================

def build_analyze_fanout():
    print("\n→ analyze.completed.v1 fan-out")
    els = []

    els.append(text("title", 60, 40, 1500, 40,
                   "analyze.completed.v1 — durable fan-out to 4 consumers",
                   size=28, color=PAL["primary"], align="left", valign="top"))
    els.append(text("subtitle", 60, 84, 1500, 22,
                   "HTTP responds with verdict; Inngest distributes the event; each consumer is independently retryable and idempotent.",
                   size=13, color=PAL["muted"], align="left", valign="top"))

    # API handler box (left)
    A_X, A_Y = 80, 230
    A_W, A_H = 220, 100
    els.append(rect("api", A_X, A_Y, A_W, A_H, stroke=PAL["primary"], fill=PAL["ochre"], sw=4))
    els.append(text("api-l", A_X, A_Y + 12, A_W, 26, "/api/analyze",
                   size=20, color=PAL["primary"], valign="top"))
    els.append(text("api-d", A_X, A_Y + 44, A_W, 56,
                   "HTTP handler\n(Vercel)",
                   size=13, color=PAL["text"], valign="top"))

    # User box (top-right of API, gets verdict JSON)
    U_X, U_Y = A_X + A_W + 120, 80
    U_W, U_H = 180, 80
    els.append(rect("user", U_X, U_Y, U_W, U_H, stroke=PAL["primary"], fill=PAL["peach"], sw=2))
    els.append(text("user-l", U_X, U_Y + 28, U_W, 24, "User",
                   size=20, color=PAL["primary"]))

    # Arrow API → User with label "verdict JSON"
    els.append(arrow("a-u", A_X + A_W, A_Y + 20, U_X, U_Y + U_H / 2,
                    color=PAL["terracotta"], sw=3))
    els.append(text("a-u-l", A_X + A_W + 30, A_Y - 30, 240, 20,
                   "verdict JSON (≤ 4s)",
                   size=12, color=PAL["terracotta"], align="left", valign="top"))

    # Inngest box (right of API)
    I_X, I_Y = A_X + A_W + 120, A_Y
    I_W, I_H = 220, 100
    els.append(rect("inngest", I_X, I_Y, I_W, I_H, stroke=PAL["primary"], fill=PAL["sage"], sw=4))
    els.append(text("inngest-l", I_X, I_Y + 12, I_W, 26, "Inngest",
                   size=20, color=PAL["primary"], valign="top"))
    els.append(text("inngest-d", I_X, I_Y + 44, I_W, 56,
                   "event id = requestId\ndedupe 24h",
                   size=13, color=PAL["text"], valign="top"))

    # Arrow API → Inngest with event name label
    els.append(arrow("a-i", A_X + A_W, A_Y + A_H - 20, I_X, I_Y + I_H / 2,
                    color=PAL["primary"], sw=2))
    els.append(text("a-i-l", A_X + A_W + 24, A_Y + A_H + 14, 320, 20,
                   "publish: analyze.completed.v1",
                   size=12, color=PAL["primary"], align="left", valign="top"))

    # 4 consumers stacked to the right of Inngest
    C_X = I_X + I_W + 100
    C_W, C_H = 360, 64
    C_GAP = 12
    consumers = [
        ("analyze-completed-report", "scam_reports + entities", PAL["terracotta"]),
        ("analyze-completed-brand", "brand_impersonation_alerts", PAL["terracotta"]),
        ("analyze-completed-cost", "cost_telemetry", PAL["terracotta"]),
        ("analyze-failure-subscriber", "failure logging only", PAL["danger_dim"]),
    ]
    for i, (name, target, color) in enumerate(consumers):
        cy = I_Y - 80 + i * (C_H + C_GAP)
        cid = f"c-{i}"
        els.append(rect(cid, C_X, cy, C_W, C_H, stroke=color, fill=PAL["bg"], sw=2))
        els.append(text(f"{cid}-l", C_X + 12, cy + 6, C_W - 24, 22, name,
                       size=14, color=color, align="left", valign="top"))
        els.append(text(f"{cid}-t", C_X + 12, cy + 32, C_W - 24, 22, "→ " + target,
                       size=12, color=PAL["text"], align="left", valign="top"))
        # Arrow from Inngest to consumer
        els.append(arrow(f"a-c-{i}", I_X + I_W, I_Y + I_H / 2, C_X, cy + C_H / 2,
                        color=PAL["primary"], sw=1))

    # Postgres box (bottom-right, target of consumers 0/1/2)
    DB_X = C_X + 60
    DB_Y = I_Y + I_H + 280
    DB_W = 240
    DB_H = 80
    els.append(rect("db", DB_X, DB_Y, DB_W, DB_H,
                   stroke=PAL["primary"], fill=PAL["ochre"], sw=4, rounded=False))
    # Cylindrical-ish: add ellipse for cap
    els.append(text("db-l", DB_X, DB_Y + 28, DB_W, 24, "Postgres (Supabase)",
                   size=18, color=PAL["primary"]))

    # Arrows from C0/C1/C2 to DB
    for i in range(3):
        cy = I_Y - 80 + i * (C_H + C_GAP)
        # bottom of consumer → top of DB
        els.append(arrow(f"a-db-{i}", C_X + C_W * (0.3 + i * 0.2), cy + C_H,
                        DB_X + DB_W * (0.3 + i * 0.2), DB_Y,
                        color=PAL["primary"], sw=1, end_head="arrow"))

    # Footer
    els.append(text("footer", 60, DB_Y + DB_H + 40, 1500, 60,
                   "Each consumer is independently retryable. Each declares idempotency: \"event.data.requestId\".\nDatabase RPCs use ON CONFLICT (idempotency_key) DO UPDATE … RETURNING id — three layers of idempotency, one event id.",
                   size=12, color=PAL["muted"], align="left", valign="top"))

    return write_doc("03-analyze-fanout.excalidraw", els)


if __name__ == "__main__":
    print("Building 3 how-ask-arthur-works diagrams (warm-editorial palette)...")
    build_system_context()
    build_container_view()
    build_analyze_fanout()
    print("\n✓ Done.")

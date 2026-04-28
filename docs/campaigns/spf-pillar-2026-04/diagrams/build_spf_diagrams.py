#!/usr/bin/env python3
"""
Generate the 4 SPF-campaign diagrams as .excalidraw JSON files,
using the ask-arthur palette.
"""

import json
import time
from pathlib import Path

OUT_DIR = Path(
    "/Users/brendanmilton/Desktop/safeverify/docs/campaigns/spf-pillar-2026-04/diagrams"
)
OUT_DIR.mkdir(exist_ok=True, parents=True)

PAL = {
    "bg": "#ffffff",
    "surface": "#ecfdf5",
    "surface_alt": "#fff8e1",
    "primary": "#001f3f",
    "accent": "#008a98",
    "muted": "#42526e",
    "text": "#171717",
    "safe": "#059669",
    "warn": "#d97706",
    "danger": "#d32f2f",
    "border": "#e2e8f0",
}

_seed = [1000]


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


def rect(el_id, x, y, w, h, stroke=None, fill=None, sw=2, rounded=True):
    return common(
        el_id,
        "rectangle",
        x,
        y,
        w,
        h,
        strokeColor=stroke or PAL["primary"],
        backgroundColor=fill or "transparent",
        strokeWidth=sw,
        roundness={"type": 3} if rounded else None,
    )


def text(el_id, x, y, w, h, content, *, size=18, color=None, align="center", valign="middle", family=1, container=None):
    return common(
        el_id,
        "text",
        x,
        y,
        w,
        h,
        strokeColor=color or PAL["text"],
        text=content,
        originalText=content,
        fontSize=size,
        fontFamily=family,
        textAlign=align,
        verticalAlign=valign,
        containerId=container,
        lineHeight=1.25,
        baseline=int(size * 0.85),
    )


def arrow(el_id, fx, fy, tx, ty, color=None, sw=2, end_head="arrow"):
    width = abs(tx - fx)
    height = abs(ty - fy)
    el = common(
        el_id,
        "arrow",
        fx,
        fy,
        width,
        height,
        strokeColor=color or PAL["accent"],
        strokeWidth=sw,
    )
    el.update(
        {
            "points": [[0, 0], [tx - fx, ty - fy]],
            "lastCommittedPoint": None,
            "startBinding": None,
            "endBinding": None,
            "startArrowhead": None,
            "endArrowhead": end_head,
            "elbowed": False,
        }
    )
    return el


def line(el_id, fx, fy, tx, ty, color=None, sw=2, style="solid"):
    width = abs(tx - fx)
    height = abs(ty - fy)
    el = common(
        el_id,
        "line",
        fx,
        fy,
        width,
        height,
        strokeColor=color or PAL["muted"],
        strokeWidth=sw,
        strokeStyle=style,
    )
    el.update(
        {
            "points": [[0, 0], [tx - fx, ty - fy]],
            "lastCommittedPoint": None,
            "startBinding": None,
            "endBinding": None,
            "startArrowhead": None,
            "endArrowhead": None,
        }
    )
    return el


def write_doc(filename, elements, bg=None):
    doc = {
        "type": "excalidraw",
        "version": 2,
        "source": "https://excalidraw.com",
        "elements": elements,
        "appState": {"viewBackgroundColor": bg or PAL["bg"], "gridSize": None},
        "files": {},
    }
    out = OUT_DIR / filename
    out.write_text(json.dumps(doc, indent=2))
    print(f"  wrote {out}")
    return out


# ============================================================================
# DIAGRAM 1 — ACMA fines timeline (linear-flow)
# ============================================================================

def build_acma_fines_timeline():
    print("\n→ ACMA fines timeline")
    els = []

    # Title
    els.append(text("title", 60, 40, 1500, 40, "Six ACMA telco penalties · July 2024 – February 2026",
                   size=28, color=PAL["primary"], align="left", valign="top"))
    els.append(text("subtitle", 60, 84, 1500, 28,
                   "The same audit finding repeated six times: identity verification gap exploited at customer-account-modification trigger.",
                   size=16, color=PAL["muted"], align="left", valign="top"))

    fines = [
        ("Telstra",       "Jul 2024", "$1.55M",  "168,000+ ID auth\nfailures",         PAL["surface"]),
        ("Circles.Life",  "May 2025", "$413K",   "26 contraventions\n$45K losses",     PAL["surface"]),
        ("Exetel",        "Jun 2025", "$695K",   "73 contraventions\n$412K losses",    PAL["surface"]),
        ("Southern Phone","Sep 2025", "$2.50M",  "168 contraventions\n$393K losses",   PAL["surface_alt"]),
        ("Optus Mobile",  "Nov 2025", "$826K",   "44 contraventions\nMAX penalty",     PAL["surface_alt"]),
        ("Lycamobile",    "Feb 2026", "$376K",   "131 contraventions\n$175K losses",   "#fee2e2"),  # light danger
    ]

    BOX_W = 220
    BOX_H = 180
    GAP = 28
    Y = 180

    for i, (telco, date, penalty, detail, fill) in enumerate(fines):
        x = 60 + i * (BOX_W + GAP)
        rect_id = f"box-{i}"
        is_max = "MAX" in detail
        stroke = PAL["danger"] if is_max else PAL["primary"]
        sw = 4 if is_max else 2
        els.append(rect(rect_id, x, Y, BOX_W, BOX_H, stroke=stroke, fill=fill, sw=sw))
        # Telco name (bold-ish via larger size)
        els.append(text(f"box-{i}-name", x, Y + 12, BOX_W, 28, telco,
                       size=20, color=PAL["primary"], valign="top"))
        # Date
        els.append(text(f"box-{i}-date", x, Y + 44, BOX_W, 20, date,
                       size=14, color=PAL["muted"], valign="top"))
        # Penalty (large)
        els.append(text(f"box-{i}-pen", x, Y + 72, BOX_W, 36, penalty,
                       size=28, color=PAL["danger"] if is_max else PAL["primary"], valign="top"))
        # Detail
        els.append(text(f"box-{i}-detail", x, Y + 116, BOX_W, 56, detail,
                       size=13, color=PAL["text"], valign="top"))

        # Arrow to next
        if i < len(fines) - 1:
            ax = x + BOX_W
            atox = x + BOX_W + GAP
            els.append(arrow(f"arrow-{i}", ax, Y + BOX_H / 2, atox, Y + BOX_H / 2))

    # Caption row below boxes — regulator quote escalation
    LABEL_Y = Y + BOX_H + 30
    els.append(text("escalation-label", 60, LABEL_Y, 1480, 22,
                   "Regulator voice escalates across the series:",
                   size=14, color=PAL["muted"], valign="top", align="left"))

    CY = LABEL_Y + 32
    quotes = [
        (0, '"unacceptable"',           PAL["muted"]),
        (2, '"cannot outsource"',       PAL["muted"]),
        (4, '"maximum penalty"',        PAL["warn"]),
        (5, '"all telcos on notice"',   PAL["danger"]),
    ]
    for i, q, color in quotes:
        x = 60 + i * (BOX_W + GAP)
        els.append(text(f"quote-{i}", x, CY, BOX_W, 24, q,
                       size=14, color=color, valign="top"))

    # Bottom event marker — TCP Code rejection + standards drafting
    BY = CY + 56
    els.append(line("event-line", 60, BY, 60 + 6 * BOX_W + 5 * GAP, BY,
                   color=PAL["primary"], sw=2, style="dashed"))

    # Annotations on the event line
    els.append(text("event-1", 60, BY + 8, 360, 24,
                   "24 Oct 2025 · ACMA rejects ATA's draft TCP Code (1st)",
                   size=13, color=PAL["primary"], align="left", valign="top"))
    els.append(text("event-2", 60 + 4 * (BOX_W + GAP), BY + 8, 540, 24,
                   "27 Mar 2026 · ACMA rejects ATA's draft TCP Code (2nd) — drafting mandatory standard",
                   size=13, color=PAL["danger"], align="left", valign="top"))

    # Footer
    els.append(text("footer", 60, BY + 64, 1500, 22,
                   "Total: A$6.36M across six telcos in 12 months. SPF Act commences 1 July 2026 with Tier 1 maximum the greater of A$52.7M, 3× benefit, or 30% of turnover.",
                   size=14, color=PAL["text"], align="left", valign="top"))

    return write_doc("acma-fines-timeline.excalidraw", els)


# ============================================================================
# DIAGRAM 2 — Regulatory architecture (multi-room)
# ============================================================================

def build_regulatory_architecture():
    print("\n→ Regulatory architecture")
    els = []

    els.append(text("title", 60, 40, 1400, 40,
                   "Australian scam-prevention regulatory architecture · post 1 July 2026",
                   size=28, color=PAL["primary"], align="left", valign="top"))
    els.append(text("subtitle", 60, 84, 1400, 24,
                   "Three regulators, one EDR scheme, one consumer-facing hotline. The architecture being completed in plain sight.",
                   size=15, color=PAL["muted"], align="left", valign="top"))

    # Top row: General regulator + sector regulators
    ROW_TOP_Y = 160
    ROOM_W = 320
    ROOM_H = 200
    ROOM_GAP = 40

    # ACCC — SPF General Regulator
    els.append(rect("accc", 60, ROW_TOP_Y, ROOM_W, ROOM_H,
                   stroke=PAL["primary"], fill=PAL["surface"], sw=4))
    els.append(text("accc-label", 76, ROW_TOP_Y + 12, ROOM_W - 32, 26,
                   "ACCC — SPF General Regulator",
                   size=18, color=PAL["primary"], align="left", valign="top"))
    els.append(text("accc-detail", 76, ROW_TOP_Y + 44, ROOM_W - 32, 140,
                   "• Civil proceedings under SPF\n• Tier 1 max: greater of\n  A$52.7M, 3× benefit, or\n  30% of adjusted turnover\n• Receives ASI from\n  designated entities",
                   size=13, color=PAL["text"], align="left", valign="top"))

    # ACMA — Telco sector
    els.append(rect("acma", 60 + ROOM_W + ROOM_GAP, ROW_TOP_Y, ROOM_W, ROOM_H,
                   stroke=PAL["primary"], fill=PAL["surface"], sw=2))
    els.append(text("acma-label", 76 + ROOM_W + ROOM_GAP, ROW_TOP_Y + 12, ROOM_W - 32, 26,
                   "ACMA — telco regulator",
                   size=18, color=PAL["primary"], align="left", valign="top"))
    els.append(text("acma-detail", 76 + ROOM_W + ROOM_GAP, ROW_TOP_Y + 44, ROOM_W - 32, 140,
                   "• Six anti-scam penalties\n  2024–2026\n• Drafting mandatory standard\n  (after rejecting ATA's draft\n  twice)\n• Operates SMS Sender ID\n  Register (live 1 Jul 2026)",
                   size=13, color=PAL["text"], align="left", valign="top"))

    # ASIC — Banks
    els.append(rect("asic", 60 + 2 * (ROOM_W + ROOM_GAP), ROW_TOP_Y, ROOM_W, ROOM_H,
                   stroke=PAL["primary"], fill=PAL["surface"], sw=2))
    els.append(text("asic-label", 76 + 2 * (ROOM_W + ROOM_GAP), ROW_TOP_Y + 12, ROOM_W - 32, 26,
                   "ASIC — bank regulator",
                   size=18, color=PAL["primary"], align="left", valign="top"))
    els.append(text("asic-detail", 76 + 2 * (ROOM_W + ROOM_GAP), ROW_TOP_Y + 44, ROOM_W - 32, 140,
                   "• Bank-side SPF obligations\n• Coordinates with APRA on\n  prudential controls\n• Receiving banks now in scope\n  under SPF compensation rules",
                   size=13, color=PAL["text"], align="left", valign="top"))

    # Middle row: AFCA EDR + NASC
    ROW_MID_Y = ROW_TOP_Y + ROOM_H + 40
    els.append(rect("afca", 60, ROW_MID_Y, ROOM_W * 1.5 + ROOM_GAP / 2, ROOM_H,
                   stroke=PAL["accent"], fill=PAL["surface_alt"], sw=4))
    els.append(text("afca-label", 76, ROW_MID_Y + 12, 700, 26,
                   "AFCA — External Dispute Resolution scheme",
                   size=18, color=PAL["accent"], align="left", valign="top"))
    els.append(text("afca-detail", 76, ROW_MID_Y + 44, 680, 140,
                   "• Authorised 1 Sep 2026; complaints accepted from 1 Jan 2027\n• David Lacey, inaugural Chief Scams Officer\n  (started 31 Mar 2026, ex-IDCARE founder)\n• World's first multi-party dispute resolution scheme for scams\n• A single complaint can implicate bank + telco + platform",
                   size=13, color=PAL["text"], align="left", valign="top"))

    # NASC — National Anti-Scam Centre
    els.append(rect("nasc", 60 + ROOM_W * 1.5 + ROOM_GAP * 1.5, ROW_MID_Y, ROOM_W * 1.5 + ROOM_GAP / 2, ROOM_H,
                   stroke=PAL["primary"], fill=PAL["surface"], sw=2))
    els.append(text("nasc-label", 76 + ROOM_W * 1.5 + ROOM_GAP * 1.5, ROW_MID_Y + 12, 700, 26,
                   "NASC — National Anti-Scam Centre",
                   size=18, color=PAL["primary"], align="left", valign="top"))
    els.append(text("nasc-detail", 76 + ROOM_W * 1.5 + ROOM_GAP * 1.5, ROW_MID_Y + 44, 680, 140,
                   "• Co-signed 7 April 2026 joint mobile-fraud alert with ACMA\n• Operates Investment Scam Fusion Cell (TPG, banks, govt)\n• Australians lost A$2.18B to scams in 2025 (+7.8% YoY)\n• Annual Targeting Scams Report",
                   size=13, color=PAL["text"], align="left", valign="top"))

    # Bottom row: IDCARE
    ROW_BOT_Y = ROW_MID_Y + ROOM_H + 40
    els.append(rect("idcare", 60 + 200, ROW_BOT_Y, ROOM_W * 2 + ROOM_GAP, 140,
                   stroke=PAL["accent"], fill=PAL["surface"], sw=2))
    els.append(text("idcare-label", 76 + 200, ROW_BOT_Y + 12, 700, 26,
                   "IDCARE — Identity-fraud restoration (consumer hotline 1800 595 160)",
                   size=18, color=PAL["accent"], align="left", valign="top"))
    els.append(text("idcare-detail", 76 + 200, ROW_BOT_Y + 44, 700, 80,
                   "• Charlotte Davidson (Group CEO since early 2026)\n• 4,000+ referrer organisations; <few hundred funders\n• Intelligence Profiling and Alerting service for subscriber organisations",
                   size=14, color=PAL["text"], align="left", valign="top"))

    # Arrows: ACCC ↔ ACMA, ACCC ↔ ASIC
    accc_x_right = 60 + ROOM_W
    acma_x_left = 60 + ROOM_W + ROOM_GAP
    els.append(arrow("a1", accc_x_right, ROW_TOP_Y + ROOM_H / 2, acma_x_left, ROW_TOP_Y + ROOM_H / 2,
                    color=PAL["accent"], sw=2))
    asic_x_left = 60 + 2 * (ROOM_W + ROOM_GAP)
    acma_x_right = 60 + 2 * ROOM_W + ROOM_GAP
    els.append(arrow("a2", acma_x_right, ROW_TOP_Y + ROOM_H / 2, asic_x_left, ROW_TOP_Y + ROOM_H / 2,
                    color=PAL["accent"], sw=2))

    # ACCC → AFCA (down-left)
    accc_y_bottom = ROW_TOP_Y + ROOM_H
    els.append(arrow("a3", 60 + ROOM_W / 2, accc_y_bottom, 60 + ROOM_W / 2, ROW_MID_Y,
                    color=PAL["accent"], sw=2))

    # ACMA → NASC (down)
    acma_x_mid = 60 + ROOM_W + ROOM_GAP + ROOM_W / 2
    nasc_x_mid = 60 + ROOM_W * 1.5 + ROOM_GAP * 1.5 + (ROOM_W * 1.5 + ROOM_GAP / 2) / 2
    els.append(arrow("a4", acma_x_mid, accc_y_bottom, nasc_x_mid, ROW_MID_Y,
                    color=PAL["accent"], sw=2))

    # AFCA → IDCARE (Lacey continuity arrow)
    els.append(arrow("a5", 60 + (ROOM_W * 1.5) / 2, ROW_MID_Y + ROOM_H,
                    60 + 200 + (ROOM_W * 2 + ROOM_GAP) / 2, ROW_BOT_Y,
                    color=PAL["accent"], sw=2))

    return write_doc("regulatory-architecture.excalidraw", els)


# ============================================================================
# DIAGRAM 3 — 1 July 2026 simultaneity
# ============================================================================

def build_july_2026_simultaneity():
    print("\n→ 1 July 2026 simultaneity")
    els = []

    els.append(text("title", 60, 40, 1200, 40,
                   "1 July 2026 · three regulatory regimes converge on one date",
                   size=28, color=PAL["primary"], align="left", valign="top"))
    els.append(text("subtitle", 60, 84, 1200, 24,
                   "Treasury, ACMA, and Attorney-General co-ordinated the timeline. The simultaneity is not an accident.",
                   size=15, color=PAL["muted"], align="left", valign="top"))

    # Big central date marker
    CX = 700
    CY = 380
    DATE_W = 360
    DATE_H = 100
    els.append(rect("date-marker", CX - DATE_W / 2, CY - DATE_H / 2, DATE_W, DATE_H,
                   stroke=PAL["primary"], fill=PAL["primary"], sw=4))
    els.append(text("date-text", CX - DATE_W / 2, CY - DATE_H / 2, DATE_W, DATE_H,
                   "1 July 2026", size=44, color=PAL["bg"], valign="middle"))

    # Three event boxes around the central date
    BOX_W = 380
    BOX_H = 200

    events = [
        # (label, body, x, y, fill_color, stroke_color)
        ("SPF Act commences",
         "Civil-penalty regime activates.\nTier 1 maximum: greater of\nA$52.7M, 3× benefit, or 30% of turnover.\nReasonable-steps defence requires\nan evidence trail that exists\n*before* the contravention.",
         60, 130, PAL["surface"], PAL["primary"]),
        ("SMS Sender ID Register",
         "Mandatory enforcement. Unregistered\nalphanumeric sender IDs display as\n\"Unverified\" to recipients on day one.\nNon-participating telcos cannot send,\ntransit, or terminate sender ID messages.",
         CX + DATE_W / 2 + 80, 130, PAL["surface"], PAL["primary"]),
        ("Penalty unit indexation",
         "Section 4AA(3) Crimes Act 1914.\nValue of every Commonwealth penalty\nunit indexed against March 2026 CPI.\nThe SPF Tier 1 maximum is HIGHER on\nday-one of SPF than the A$52.7M figure\nquoted in every legal explainer.",
         CX - BOX_W / 2, CY + DATE_H / 2 + 60, PAL["surface_alt"], PAL["accent"]),
    ]

    for i, (label, body, x, y, fill, stroke) in enumerate(events):
        bid = f"event-{i}"
        els.append(rect(bid, x, y, BOX_W, BOX_H, stroke=stroke, fill=fill, sw=2))
        els.append(text(f"{bid}-label", x + 16, y + 12, BOX_W - 32, 28, label,
                       size=20, color=stroke, align="left", valign="top"))
        els.append(text(f"{bid}-body", x + 16, y + 50, BOX_W - 32, BOX_H - 60, body,
                       size=14, color=PAL["text"], align="left", valign="top"))

        # Arrow from event to central date
        if i == 0:  # left → right to date
            els.append(arrow(f"arr-{i}", x + BOX_W, y + BOX_H / 2,
                           CX - DATE_W / 2, CY, color=PAL["accent"], sw=2))
        elif i == 1:  # right → left to date
            els.append(arrow(f"arr-{i}", x, y + BOX_H / 2,
                           CX + DATE_W / 2, CY, color=PAL["accent"], sw=2))
        else:  # bottom → up to date
            els.append(arrow(f"arr-{i}", x + BOX_W / 2, y,
                           CX, CY + DATE_H / 2, color=PAL["accent"], sw=2))

    # Footer
    els.append(text("footer", 60, 720, 1280, 80,
                   "Reading these as three separate workstreams double-counts engineering capacity.\nCompliance roadmaps that arrive in Q4 2026 collide with AFCA EDR commencement\n(1 January 2027) and the first wave of public ASI reporting obligations.",
                   size=14, color=PAL["muted"], align="left", valign="top"))

    return write_doc("1-july-2026-simultaneity.excalidraw", els)


# ============================================================================
# DIAGRAM 4 — Buyer vs builder (comparison columns)
# ============================================================================

def build_buyer_vs_builder():
    print("\n→ Buyer vs builder")
    els = []

    els.append(text("title", 60, 40, 1300, 40,
                   "Buyer vs. builder · the Australian telco scam-intelligence map",
                   size=28, color=PAL["primary"], align="left", valign="top"))
    els.append(text("subtitle", 60, 84, 1300, 24,
                   "Telstra builds. Every other Australian telco buys. The question is which vendor — and the deadline is July 2026.",
                   size=15, color=PAL["muted"], align="left", valign="top"))

    COL_W = 580
    COL_GAP = 60
    COL_Y = 160
    COL_H = 540

    # Left column — Telstra (builder)
    els.append(rect("col-builder", 60, COL_Y, COL_W, COL_H,
                   stroke=PAL["primary"], fill=PAL["surface"], sw=4))
    els.append(rect("builder-header", 60, COL_Y, COL_W, 64,
                   stroke=PAL["primary"], fill=PAL["primary"], sw=4))
    els.append(text("builder-header-text", 60, COL_Y, COL_W, 64,
                   "BUILDER · Telstra (only)",
                   size=24, color=PAL["bg"], valign="middle"))

    builder_lines = [
        ("Cleaner Pipes",
         "10M+ scam/unwanted calls blocked per month at network layer"),
        ("Quantium Telstra (JV)",
         "Joint venture with Quantium — productised IP,\nsold back to all four major banks"),
        ("Scam Indicator",
         "Joint with CommBank · phone-call detection · national\nrollout Oct 2023 · landlines added Nov 2024"),
        ("Fraud Indicator",
         "Identity-theft detection via mobile-usage pattern analysis\nLaunched Feb 2025 · +25% to CommBank's fraud-detection rate"),
        ("Why build?",
         "At Telstra's scale, a fraction of a basis point of fraud\nloss avoided pays for an in-house JV"),
    ]
    by = COL_Y + 80
    for i, (head, body) in enumerate(builder_lines):
        ly = by + i * 92
        els.append(text(f"b-h-{i}", 80, ly, COL_W - 40, 24, head,
                       size=17, color=PAL["primary"], align="left", valign="top"))
        els.append(text(f"b-b-{i}", 80, ly + 28, COL_W - 40, 56, body,
                       size=12, color=PAL["text"], align="left", valign="top"))

    # Right column — Buyers
    bx = 60 + COL_W + COL_GAP
    els.append(rect("col-buyer", bx, COL_Y, COL_W, COL_H,
                   stroke=PAL["accent"], fill=PAL["surface_alt"], sw=4))
    els.append(rect("buyer-header", bx, COL_Y, COL_W, 64,
                   stroke=PAL["accent"], fill=PAL["accent"], sw=4))
    els.append(text("buyer-header-text", bx, COL_Y, COL_W, 64,
                   "BUYERS · Every other Australian telco",
                   size=24, color=PAL["bg"], valign="middle"))

    buyer_lines = [
        ("TPG Telecom",
         "Buys Mavenir CallShield/SpamShield (19M calls + 213M SMS\nintercepted H1 '24). Deploys Apate.ai (280K+ scams diverted,\nA$7.6M losses prevented). Hiring 4× scam/fraud roles now."),
        ("Vocus",
         "Tollring Scam Protect at network layer (foundation customer\nsince 2021). Oct 2025 Dodo breach: IDCARE-led restoration.\nIrlando ex-Zayo (Jul 2025), first vendor cycle."),
        ("Optus Mobile",
         "Mid-leadership-rebuild. Coles Mobile A$826K MAX penalty\n(Nov 2025). Identity-verification gap was a third-party\nvendor failure — vendor relationship is the buying decision."),
        ("Aussie Broadband, Pivotel, Felix,",
         "No budget to build at MVNO/second-tier scale.\nWill buy or be penalised."),
        ("iiNet, long tail of MVNOs", ""),
    ]
    for i, (head, body) in enumerate(buyer_lines):
        ly = by + i * 92
        els.append(text(f"by-h-{i}", bx + 20, ly, COL_W - 40, 24, head,
                       size=17, color=PAL["accent"], align="left", valign="top"))
        if body:
            els.append(text(f"by-b-{i}", bx + 20, ly + 28, COL_W - 40, 56, body,
                       size=12, color=PAL["text"], align="left", valign="top"))

    # Footer
    els.append(text("footer", 60, COL_Y + COL_H + 40, 1300, 80,
                   "If you are anywhere in Australian telco except Telstra HQ, the question\nbetween today and 1 July 2026 is which vendor, for which SPF principle,\nwith what evidence trail. The most expensive vendor decision in 2026 is the one that does not get made.",
                   size=15, color=PAL["primary"], align="left", valign="top"))

    return write_doc("buyer-vs-builder.excalidraw", els)


if __name__ == "__main__":
    print("Building 4 SPF-campaign diagrams...")
    build_acma_fines_timeline()
    build_regulatory_architecture()
    build_july_2026_simultaneity()
    build_buyer_vs_builder()
    print("\n✓ Done.")

#!/usr/bin/env python3
"""Render PARALLAX's architecture brief with exact vector diagrams.

Usage:
  python3 scripts/render-architecture.py
  python3 scripts/render-architecture.py --screenshot /path/to/overview.png --passed-tests 99

The optional screenshot must be a real application capture. Test count is an
explicit release-checkpoint input, not a fabricated measurement. The lab table
reads reports/verification.json when it exists and labels its actual transport.
Requires reportlab and pypdf. Output: output/pdf/PARALLAX-Architecture.pdf.
"""
from __future__ import annotations

import argparse
import html
import json
import math
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, PageTemplate, Frame, Flowable, Paragraph, Spacer,
    Table, TableStyle, PageBreak, Image,
)
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "PARALLAX-Architecture.pdf"
PAGE_W, PAGE_H = A4
MARGIN = 45
BODY_W = PAGE_W - 2 * MARGIN
INK = colors.HexColor("#26372f")
MUTED = colors.HexColor("#66756c")
PAPER = colors.HexColor("#f7f7f1")
LINE = colors.HexColor("#d9dfd3")
GREEN = colors.HexColor("#e8efda")
CORAL = colors.HexColor("#efbb99")
TEAL = colors.HexColor("#537f78")
WHITE = colors.white
AMBER = colors.HexColor("#f4e9cc")
PALE = colors.HexColor("#eef2eb")

font_root = Path("/usr/share/fonts/truetype/dejavu")
for name, filename, fallback in [
    ("Body", "DejaVuSans.ttf", "Helvetica"), ("BodyBold", "DejaVuSans-Bold.ttf", "Helvetica-Bold"),
    ("Code", "DejaVuSansMono.ttf", "Courier"), ("CodeBold", "DejaVuSansMono-Bold.ttf", "Courier-Bold"),
]:
    path = font_root / filename
    if path.exists():
        pdfmetrics.registerFont(TTFont(name, str(path)))
    else:
        pdfmetrics.registerFont(pdfmetrics.Font(name, fallback, "WinAnsiEncoding"))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="BodyBold", italic="Body", boldItalic="BodyBold")

STYLES = {
    "body": ParagraphStyle("body", fontName="Body", fontSize=9.2, leading=13.6,
                           textColor=INK, spaceAfter=8),
    "lead": ParagraphStyle("lead", fontName="Body", fontSize=10.6, leading=15.4,
                           textColor=MUTED, spaceAfter=13),
    "h1": ParagraphStyle("h1", fontName="BodyBold", fontSize=24, leading=28.5,
                         textColor=INK, spaceAfter=11),
    "h2": ParagraphStyle("h2", fontName="BodyBold", fontSize=11.6, leading=15,
                         textColor=INK, spaceBefore=10, spaceAfter=6),
    "kicker": ParagraphStyle("kicker", fontName="BodyBold", fontSize=8.1, leading=12,
                             textColor=TEAL, spaceAfter=8),
    "small": ParagraphStyle("small", fontName="Body", fontSize=8.1, leading=11.6,
                            textColor=MUTED, spaceAfter=7),
    "cell": ParagraphStyle("cell", fontName="Body", fontSize=8.15, leading=11.5,
                           textColor=INK, spaceAfter=0, splitLongWords=True),
    "cellhead": ParagraphStyle("cellhead", fontName="BodyBold", fontSize=8, leading=11.3,
                               textColor=INK, spaceAfter=0),
    "code": ParagraphStyle("code", fontName="Code", fontSize=7.6, leading=11,
                           textColor=INK, spaceAfter=0, splitLongWords=True),
    "caption": ParagraphStyle("caption", fontName="Body", fontSize=7.7, leading=10.8,
                              textColor=MUTED, spaceBefore=5, spaceAfter=9),
    "callout": ParagraphStyle("callout", fontName="Body", fontSize=9.5, leading=14,
                              textColor=INK, spaceAfter=0),
}


def clean(text):
    return str(text).replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", " - ")


def p(text, style="body"):
    return Paragraph(clean(text), STYLES[style])


def table(rows, widths, header=True):
    cells = []
    for i, row in enumerate(rows):
        cells.append([p(str(cell), "cellhead" if i == 0 and header else "cell") for cell in row])
    t = Table(cells, colWidths=[BODY_W * w for w in widths], hAlign="LEFT", repeatRows=1 if header else 0)
    instructions = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), .4, LINE),
    ]
    if header:
        instructions += [("BACKGROUND", (0, 0), (-1, 0), GREEN), ("BOTTOMPADDING", (0, 0), (-1, 0), 8)]
    t.setStyle(TableStyle(instructions))
    t.spaceAfter = 10
    return t


def box(text, fill=GREEN):
    t = Table([[p(text, "callout")]], colWidths=[BODY_W], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), .5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 13),
        ("RIGHTPADDING", (0, 0), (-1, -1), 13),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    t.spaceBefore = 4
    t.spaceAfter = 11
    return t


def code(lines):
    content = "<br/>".join(html.escape(line).replace(" ", "&nbsp;") for line in clean(lines).strip().splitlines())
    t = Table([[p(content, "code")]], colWidths=[BODY_W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PALE),
        ("BOX", (0, 0), (-1, -1), .5, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    t.spaceAfter = 10
    return t


def section(number, title, lead=None):
    items = [p(f"{number:02d}  /  IMPLEMENTATION GUIDE", "kicker"), p(title, "h1")]
    if lead:
        items.append(p(lead, "lead"))
    return items


def source(text):
    return p("Implementation: " + text, "caption")


class Diagram(Flowable):
    """Exact vector diagram with top-origin coordinates and orthogonal routing."""
    def __init__(self, height, nodes, edges, notes=None):
        Flowable.__init__(self)
        self.width, self.height = BODY_W, height
        self.nodes = {n["id"]: n for n in nodes}
        self.edges, self.notes = edges, notes or []

    def draw(self):
        c = self.canv
        c.saveState()
        c.setFillColor(PAPER)
        c.roundRect(0, 0, self.width, self.height, 9, fill=1, stroke=0)

        def anchor(nid, side):
            n = self.nodes[nid]
            x, y, w, h = n["x"], self.height - n["y"] - n["h"], n["w"], n["h"]
            return {"top": (x+w/2, y+h), "bottom": (x+w/2, y),
                    "left": (x, y+h/2), "right": (x+w, y+h/2)}[side]

        for e in self.edges:
            start = anchor(e["from"], e.get("from_side", "bottom"))
            end = anchor(e["to"], e.get("to_side", "top"))
            points = [start] + [(x, self.height-y) for x, y in e.get("via", [])] + [end]
            c.setStrokeColor(e.get("color", MUTED))
            c.setLineWidth(.95)
            path = c.beginPath()
            path.moveTo(*points[0])
            for pt in points[1:]:
                path.lineTo(*pt)
            c.drawPath(path, stroke=1)
            x0, y0 = points[-2]
            x1, y1 = points[-1]
            angle = math.atan2(y1-y0, x1-x0)
            a = 4.5
            arrow = c.beginPath()
            arrow.moveTo(x1, y1)
            arrow.lineTo(x1-a*math.cos(angle-.45), y1-a*math.sin(angle-.45))
            arrow.lineTo(x1-a*math.cos(angle+.45), y1-a*math.sin(angle+.45))
            arrow.close()
            c.setFillColor(e.get("color", MUTED))
            c.drawPath(arrow, fill=1, stroke=0)
            if e.get("label"):
                lx, ly = e["label_at"]
                label = clean(e["label"])
                c.setFont("Body", 6.8)
                tw = pdfmetrics.stringWidth(label, "Body", 6.8)
                c.setFillColor(PAPER)
                c.rect(lx-tw/2-3, self.height-ly-3, tw+6, 10, fill=1, stroke=0)
                c.setFillColor(MUTED)
                c.drawCentredString(lx, self.height-ly, label)

        for n in self.nodes.values():
            x, y, w, h = n["x"], self.height-n["y"]-n["h"], n["w"], n["h"]
            c.setFillColor(n.get("fill", WHITE))
            c.setStrokeColor(n.get("stroke", LINE))
            c.setLineWidth(.65)
            c.roundRect(x, y, w, h, 6, fill=1, stroke=1)
            lines = n["label"].split("\n")
            c.setFillColor(INK)
            size = n.get("size", 8.1)
            font = "BodyBold"
            c.setFont(font, size)
            start_y = y+h/2+(len(lines)-1)*5-3
            for line in lines:
                c.drawCentredString(x+w/2, start_y, clean(line))
                start_y -= 10
        for x, y, text in self.notes:
            c.setFillColor(MUTED)
            c.setFont("Body", 7)
            c.drawString(x, self.height-y, clean(text))
        c.restoreState()


class Metrics(Flowable):
    def __init__(self, cards, height=72):
        Flowable.__init__(self)
        self.width, self.height = BODY_W, height
        self.cards = cards

    def draw(self):
        c = self.canv
        gap = 10
        width = (BODY_W-gap*(len(self.cards)-1))/len(self.cards)
        for i, (value, label, detail) in enumerate(self.cards):
            x=i*(width+gap)
            c.setFillColor(GREEN if i % 2 == 0 else PAPER)
            c.setStrokeColor(LINE)
            c.roundRect(x, 0, width, self.height, 6, fill=1, stroke=1)
            c.setFillColor(INK)
            c.setFont("BodyBold", 23)
            c.drawString(x+12, self.height-31, str(value))
            c.setFont("BodyBold", 7.6)
            c.drawString(x+12, self.height-47, label)
            c.setFillColor(MUTED)
            c.setFont("Body", 6.8)
            c.drawString(x+12, self.height-60, detail)


class Cover(Flowable):
    def __init__(self):
        Flowable.__init__(self)
        self.width, self.height = BODY_W, 714

    def draw(self):
        c=self.canv
        c.saveState()
        c.setFillColor(INK)
        c.roundRect(0, self.height-73, BODY_W, 73, 8, fill=1, stroke=0)
        c.setStrokeColor(WHITE)
        c.setLineWidth(1.3)
        c.rect(20, self.height-45, 13, 20)
        c.setStrokeColor(CORAL)
        c.rect(27, self.height-50, 13, 20)
        c.setFillColor(WHITE)
        c.setFont("BodyBold", 23)
        c.drawString(56, self.height-47, "PARALLAX.")
        c.setFont("Body", 8)
        c.drawRightString(BODY_W-18, self.height-31, "GRAPH HACKS")
        c.drawRightString(BODY_W-18, self.height-47, "TRACK 01 + TRACK 02")
        top=self.height-115
        c.setFillColor(TEAL)
        c.setFont("BodyBold", 8.3)
        c.drawString(0, top, "ARCHITECTURE / WORKFLOW / DESIGN")
        title=Paragraph("Find the agreement<br/>that breaks<br/>between teams.", ParagraphStyle(
            "cover-title", fontName="BodyBold", fontSize=33, leading=40, textColor=INK))
        _, h=title.wrap(BODY_W, 170)
        title.drawOn(c, 0, top-19-h)
        subtitle=Paragraph("Connected evidence. Reproducible counterexamples.<br/>Human decisions that agents remember.", STYLES["lead"])
        _, sh=subtitle.wrap(BODY_W-12, 80)
        subtitle.drawOn(c, 0, top-38-h-sh)
        y=208
        c.setFillColor(CORAL)
        c.roundRect(0, y, BODY_W, 149, 8, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont("BodyBold", 8)
        c.drawString(17, y+128, "ONE CUSTOMER. TWO ACTIVATION CLOCKS.")
        c.setStrokeColor(INK)
        c.setLineWidth(1)
        c.line(36, y+66, BODY_W-36, y+66)
        positions=[36, 164, 310, BODY_W-36]
        for px, day, label in zip(positions, ["0", "7", "14", "21"],
                                 ["Email verified", "First use", "Billing charges", "Promise expires"]):
            c.setFillColor(INK)
            c.circle(px, y+66, 3.1, fill=1, stroke=0)
            c.setFont("BodyBold", 21)
            c.drawCentredString(px, y+85, day)
            c.setFont("Body", 6.7)
            c.drawCentredString(px, y+45, label)
        c.setFont("BodyBold", 9.3)
        c.drawString(17, y+18, "The reviewed obligation fails: day 14 is earlier than day 21.")
        desc=Paragraph("PARALLAX connects the promise to its rules, sources, event producer and owners. "
                       "A bounded checker establishes the mismatch; an explicit human workflow records the response.", STYLES["body"])
        _, dh=desc.wrap(BODY_W, 75)
        desc.drawOn(c, 0, y-21-dh)
        c.setStrokeColor(LINE)
        c.line(0, 81, BODY_W, 81)
        c.setFillColor(MUTED)
        c.setFont("Body", 8.3)
        c.drawString(0, 58, "Implementation guide 1.0")
        c.drawString(0, 42, "18 October 2026")
        c.drawRightString(BODY_W, 58, "Synthetic company demonstration")
        c.drawRightString(BODY_W, 42, "Source: ayushmanthehero-lab/Parallax")
        c.linkURL("https://github.com/ayushmanthehero-lab/Parallax", (BODY_W-244, 37, BODY_W, 70), relative=1)
        c.restoreState()


def on_page(c, doc):
    c.saveState()
    c.setFillColor(WHITE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    if doc.page != 1:
        c.setFillColor(INK)
        c.setFont("BodyBold", 8.6)
        c.drawString(MARGIN, PAGE_H-29, "PARALLAX.")
        c.setFillColor(MUTED)
        c.setFont("Body", 7)
        c.drawRightString(PAGE_W-MARGIN, PAGE_H-29, "ARCHITECTURE / WORKFLOW / DESIGN")
        c.setStrokeColor(LINE)
        c.line(MARGIN, PAGE_H-38, PAGE_W-MARGIN, PAGE_H-38)
    c.setStrokeColor(LINE)
    c.line(MARGIN, 35, PAGE_W-MARGIN, 35)
    c.setFillColor(MUTED)
    c.setFont("Body", 7)
    c.drawString(MARGIN, 23, "Implementation guide 1.0  |  18 October 2026")
    c.drawRightString(PAGE_W-MARGIN, 23, f"{doc.page:02d} / 16")
    c.restoreState()


def build(args):
    report_path = ROOT / "reports" / "verification.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}
    concurrency = report.get("concurrency") or {}
    summary = report.get("summary") or {}
    connection = report.get("connection") or {}
    story = [Cover(), PageBreak()]

    # Page 2: product, decision boundary and judging narrative.
    story += section(1, "The product, in one handoff",
        "Find a broken promise with evidence, then preserve the decision and unfinished work.")
    story += [
        p("Teams can agree on a word while disagreeing about the event, threshold or entitlement behind it. "
          "PARALLAX asks for a reviewed shared obligation first. A lexical difference becomes actionable only "
          "when a concrete admissible customer scenario violates that obligation."),
        box("<b>Core question</b><br/>What breaks, which connected evidence establishes it, who owns the response, "
            "and what still needs to happen?"),
        table([
            ["User need", "Implemented response"],
            ["Explain the mismatch", "Exact source revisions, current structured mappings and a reproducible witness with a calculation trace."],
            ["Act on evidence", "Open one clarification per scenario revision and route it to graph-linked human owners."],
            ["Coordinate follow-through", "Preview a reviewed choice, approve it, create tasks, require evidence and verify the full declared domain."],
            ["Remember safely", "Persist episodes, decisions, procedures and conversation; mark old scenario-version memories inapplicable."],
        ], [.28, .72]),
        p("Why it fits both tracks", "h2"),
        table([
            ["Track 01: connected-data action", "Track 02: memory and coordination"],
            ["MCP tools traverse the graph, run native shortestPath, verify the obligation and open a justified case.",
             "All roles read the same durable graph. Pending work, memory, run receipts and conversation survive requests."],
            ["Judge moment: day 0 / day 7 produces a charge at 14 against a promise until 21.",
             "Judge moment: approve, reload, resume tasks, inspect stale-memory rejection and switch tenant."],
        ], [.5, .5]),
        p("The workspace uses fictional companies, people and source material. It records a human reviewer's actions "
          "under a private visitor session. It does not send external messages, change real billing or independently "
          "verify a live engineering deployment. The human task boundary is visible throughout the interface."),
        source("lib/domain/scenarios.mjs; lib/server/service.mjs; components/workspace.tsx"),
        PageBreak(),
    ]

    # Page 3: deployment topology.
    story += section(2, "Vercel and FalkorDB Cloud",
        "The selected host for connected evidence and shared memory is FalkorDB Cloud.")
    story += [
        Diagram(278, [
            dict(id="browser", x=168, y=14, w=169, h=31, label="Browser workspace", fill=GREEN),
            dict(id="web", x=146, y=73, w=213, h=39, label="Next.js on Vercel\nSession boundary and service"),
            dict(id="mcp", x=16, y=148, w=145, h=41, label="MCP orchestrator\nBounded checker", fill=GREEN),
            dict(id="gateway", x=197, y=148, w=157, h=41, label="FalkorDB Cloud\nGraph + agent memory", fill=CORAL),
            dict(id="model", x=382, y=148, w=107, h=41, label="Optional\nmodel provider"),
            dict(id="db", x=184, y=230, w=183, h=35, label="Provisioned instance storage", fill=GREEN),
        ], [
            {"from":"browser","to":"web","label":"HTTPS + signed cookie","label_at":(253,62)},
            {"from":"web","to":"mcp","via":[(89,127)],"label":"Scoped tools","label_at":(95,135)},
            {"from":"web","to":"gateway","label":"Official SDK + TLS","label_at":(283,133)},
            {"from":"web","to":"model","via":[(435,127)]},
            {"from":"mcp","to":"gateway","from_side":"right","to_side":"left","label":"Graph I/O","label_at":(179,157)},
            {"from":"gateway","to":"db","label":"Confirm actual guarantees","label_at":(276,214)},
        ]),
        p("<b>FalkorDB is the database; Vercel hosts the application.</b> The official client connects directly to "
          "the provisioned Cloud hostname and port with TLS. Actual TLS, storage and recovery features depend on "
          "the instance. Railway is an optional host for the tested self-hosted gateway; it is not required by "
          "the selected Cloud route. The application never substitutes a JSON graph when FalkorDB is unavailable."),
        table([
            ["Component", "Version / selected implementation"],
            ["Web and runtime", "Next.js 16.4.2; React 19.3.1; Node 24 deployment"],
            ["Graph client", "Official falkordb 6.8.0 (requires Node >=22)"],
            ["Verified Lite engine", "Official falkordblite 0.3.0; Linux x64 binary 8.2.3-falkordb.4.16.3"],
            ["Verified local module", "41603 = FalkorDB 4.16.3; inspect the deployed Cloud module separately"],
            ["Protocol and model identity", "MCP SDK 1.32.1; @vercel/oidc 4.0.1"],
        ], [.31, .69]),
        p("The optional gateway uses Node 24 Trixie for the packaged binary's native libraries and pins its engine. "
          "For direct Cloud, omit FALKORDB_HTTP_URL and FALKORDB_SOCKET; use the actual host, port, credentials and "
          "TLS configuration. A package version does not establish a Cloud engine version.", "small"),
        source("lib/server/db.mjs; http-db.mjs; deploy/gateway/; package.json"),
        PageBreak(),
    ]

    # Page 4: exact evidence schema.
    story += section(3, "The evidence is a real graph",
        "A source, rule, event producer and obligation are separate entities that can be traversed and inspected.")
    story += [
        Diagram(292, [
            dict(id="handoff", x=177, y=12, w=151, h=31, label="Handoff: trial", fill=GREEN),
            dict(id="obligation", x=24, y=81, w=158, h=33, label="Shared obligation"),
            dict(id="definition", x=323, y=81, w=158, h=33, label="Department definition"),
            dict(id="rule", x=177, y=147, w=151, h=34, label="Billing rule @1", fill=CORAL),
            dict(id="source", x=16, y=227, w=154, h=39, label="Source revision\nExact text + content hash"),
            dict(id="event", x=186, y=227, w=143, h=39, label="ACCOUNT_ACTIVATED"),
            dict(id="producer", x=359, y=227, w=130, h=39, label="Identity producer"),
        ], [
            {"from":"handoff","to":"obligation","via":[(103,57)],"label":"HAS_OBLIGATION","label_at":(105,64)},
            {"from":"handoff","to":"definition","via":[(402,57)],"label":"USES_DEFINITION","label_at":(400,64)},
            {"from":"obligation","to":"rule","via":[(103,131),(253,131)],"label":"COMPARES","label_at":(119,143)},
            {"from":"definition","to":"rule","via":[(402,131),(253,131)],"label":"IMPLEMENTED_BY","label_at":(395,143)},
            {"from":"rule","to":"source","via":[(253,201),(93,201)],"label":"SOURCED_FROM","label_at":(87,217)},
            {"from":"rule","to":"event","label":"READS_EVENT","label_at":(299,209)},
            {"from":"event","to":"producer","from_side":"right","to_side":"left","label":"EMITTED_BY","label_at":(414,217)},
        ]),
        p("The full trial traversal continues from the producer to its reviewed Engineering source and owning "
          "department. The checker receives the current rules and sources; historical paths remain available. "
          "The missing-producer scenario intentionally has no reviewed producer contract and returns UNKNOWN."),
        p("New rule versions retain department ownership and rebuild READS_EVENT links from the adopted expression "
          "and existing modeled input/event bindings, including rule dependencies. Old provenance remains; missing "
          "producers stay missing. This version-creation behavior does not backfill existing visitor graphs.", "small"),
        table([
            ["Entity", "What it contributes"],
            ["Promise + Obligation", "Customer-facing promise and an explicit reviewed Boolean relation that must hold."],
            ["Definition + Rule", "A department's meaning and its versioned, structured implementation mapping."],
            ["Source + SourceRevision", "Logical source identity, exact text, reviewed status, content hash and retained versions."],
            ["EventType + Producer", "Event meaning, producer identity, ownership and source provenance."],
        ], [.32, .68]),
        p("Every entity has a stable Entity.id and a specific type label. A range index and UNIQUE constraint support "
          "identity lookup; a SourceRevision full-text index supports lexical source search. Structured expressions "
          "are JSON properties of individual typed nodes, not one workspace blob.", "small"),
        source("lib/server/seed.mjs; service.mjs; docs/QUERIES.md"),
        PageBreak(),
    ]

    # Page 5: coordination schema.
    story += section(4, "Evidence becomes shared work",
        "Runtime nodes preserve the original finding, the approved response and the work that is still pending.")
    story += [
        Diagram(268, [
            dict(id="v", x=24, y=15, w=138, h=34, label="Verification run", fill=CORAL),
            dict(id="c", x=183, y=15, w=138, h=34, label="Clarification case", fill=GREEN),
            dict(id="d", x=344, y=15, w=137, h=34, label="Human decision"),
            dict(id="w", x=24, y=111, w=138, h=34, label="Counterexample"),
            dict(id="h", x=183, y=111, w=138, h=34, label="Handoff"),
            dict(id="t", x=344, y=111, w=137, h=34, label="Implementation task", fill=CORAL),
            dict(id="m", x=109, y=214, w=151, h=34, label="Memory", fill=GREEN),
            dict(id="p", x=344, y=214, w=137, h=34, label="Accountable person"),
        ], [
            {"from":"c","to":"v","from_side":"left","to_side":"right","label":"BASED_ON","label_at":(173,9)},
            {"from":"c","to":"d","from_side":"right","to_side":"left","label":"HAS_DECISION","label_at":(333,58)},
            {"from":"v","to":"w","label":"FOUND","label_at":(93,84)},
            {"from":"c","to":"h","label":"ABOUT","label_at":(252,84)},
            {"from":"c","to":"t","via":[(252,72),(413,72)],"label":"HAS_TASK","label_at":(415,89)},
            {"from":"t","to":"p","label":"ASSIGNED_TO","label_at":(413,182)},
            {"from":"m","to":"h","label":"APPLIES_TO","label_at":(213,186),"from_side":"top","to_side":"bottom"},
            {"from":"m","to":"c","from_side":"left","to_side":"bottom","via":[(8,231),(8,63),(252,63)],"label":"LEARNED_FROM","label_at":(75,72)},
        ]),
        p("Memory links to the case that taught an episode or the decision that established a semantic/procedural "
          "record. The graph stores actual ToolCall receipts under AgentRun and messages under Session. "
          "AuditEvent and Command nodes connect a state change to its actor and idempotency record."),
        table([
            ["Runtime entity", "Persistent contract"],
            ["Case / Decision / Task", "Separate statuses and revisions; approval creates pending tasks; completion evidence precedes resolution."],
            ["Verification / Counterexample", "Disclosed finite bounds, exact versions, evaluated counts, witness values and trace."],
            ["Memory / Session / Message", "Three memory kinds, applicability, conversation text and timestamps."],
            ["AgentRun / ToolCall", "Mode, current lease/fence, checkpoint, status, actual arguments/results and duration."],
            ["Command / AuditEvent", "Payload-bound replay result; append-oriented transition history and actor details."],
        ], [.34, .66]),
        p("A Decision-to-Case RESOLVES edge is written on approval to record intent. The actual Case.status "
          "and fresh VERIFIED_BY result establish completion. No edge alone means that human implementation happened.", "small"),
        source("lib/server/service.mjs; util.mjs; lib/contracts.ts"),
        PageBreak(),
    ]

    # Page 6: verifier.
    story += section(5, "A checker with explicit limits",
        "A deterministic calculation establishes the result. The language model selects tools and explains their evidence.")
    story += [
        code('{"op":"add","args":[\n  {"op":"var","name":"first_use_day"},\n  {"op":"const","value":14}\n]}'),
        p("The closed expression language supports constants, variables, arithmetic addition/subtraction, comparisons, "
          "Boolean logic and set membership. It does not evaluate source text or dynamic code. Numeric inputs "
          "must be finite and declare units. Rule dependencies are ordered; cycles and missing evidence are rejected."),
        table([
            ["Verdict", "Meaning and allowed action"],
            ["VIOLATED", "One admissible assignment makes the reviewed obligation false. A case can be opened for that exact current revision."],
            ["VALID_WITHIN_BOUND", "Every admissible assignment in the effective finite domain was checked and none violates. At least one must exist."],
            ["NOT_DISPROVED", "The candidate budget ended without a witness. Unchecked assignments remain."],
            ["UNKNOWN", "Semantics/evidence are missing, unreviewed or unsupported, or no admissible assignment exists."],
        ], [.32, .68]),
        box("<b>Never widen the claim.</b> A selected input narrows the effective domain. A passing selected-input "
            "run does not mark the full handoff valid. Resolution always rechecks the entire declared domain."),
        table([
            ["Bound", "Implemented value"],
            ["Service candidate budget", "5,000; excluded candidates also consume examination budget"],
            ["Expression size", "Depth 24; at most 512 AST nodes"],
            ["Scenario model", "At most 16 inputs, 32 rules, 1,024 values per input and 100,000 declared candidates"],
        ], [.35, .65]),
        p("Every result includes checker version, declared/effective domains, examined/evaluated/excluded counts, "
          "completeness, rule/source snapshots and an evaluation trace. A found witness is conclusive for its input "
          "even when the search stopped before exhaustive coverage.", "small"),
        source("lib/domain/checker.mjs; lib/server/service.mjs; agents.mjs"),
        PageBreak(),
    ]

    # Page 7: six cases.
    story += section(6, "Six scenarios, including controls",
        "Each scenario has a shared obligation, finite inputs, reviewed mappings and accountable departments.")
    story += [
        table([
            ["Scenario", "Input domain and obligation", "Fresh Acme result"],
            ["Trial gap", "Email days {0,7,14}; first-use days {0,7,14,21}; first use cannot precede verification. Charge >= promised expiry.",
             "<b>VIOLATED</b><br/>0 / 7 gives charge 14 and promise 21."],
            ["Invisible beta customer", "Human sessions {0,1,3}; automation runs {0,1,10}. Invitation implies human-based eligibility.",
             "<b>VIOLATED</b><br/>0 human / 1 automation is invited but ineligible."],
            ["Untested boundary", "Score {0,99,100,101,150}. A lead promised priority must receive it.",
             "<b>VIOLATED</b><br/>100 passes >=100 and fails >100."],
            ["Inclusive bundle", "Two Boolean entitlements. Every granted bundle requires both capabilities.",
             "<b>VIOLATED</b><br/>One entitlement passes OR but fails AND."],
            ["Equivalent meanings", "Request count {0,1,99,100,101,200}. Admission matches the reviewed quota promise.",
             "<b>VALID_WITHIN_BOUND</b><br/>All six values confirm <=100 equals NOT(>100)."],
            ["Missing event owner", "Boolean event/settlement fields exist, but a producer contract and mapping are unreviewed.",
             "<b>UNKNOWN</b><br/>No fabricated witness or case."],
        ], [.23, .47, .30]),
        p("Why the controls matter", "h2"),
        p("The equivalent scenario demonstrates that wording differences need not be a conflict. The missing-evidence "
          "scenario demonstrates that an unknown meaning cannot be promoted into a verified result. Together they "
          "make the system's threshold for action visible to a reviewer."),
        box("<b>Tenant control:</b> Nova Labs defines its trial promise from email verification, so its initial trial "
            "is valid within the declared domain. The same scenario ID in a different tenant must not inherit Acme's "
            "meaning, case or learned decision."),
        p("NOT_DISPROVED is exercised by a constrained search budget in the domain tests; it is not an invented "
          "seventh business fixture. The normal service budget is sufficient for the small demonstration domains.", "small"),
        source("lib/domain/scenarios.mjs; tests/checker.test.mjs"),
        PageBreak(),
    ]

    # Page 8: end-to-end state machine.
    story += section(7, "The complete human workflow",
        "Approval records intent. Task evidence and a new verification establish a modeled resolution.")
    story += [
        Diagram(292, [
            dict(id="start", x=161, y=12, w=183, h=33, label="Reviewed evidence + obligation", fill=GREEN),
            dict(id="check", x=161, y=76, w=183, h=33, label="MCP investigation + checker"),
            dict(id="hold", x=15, y=149, w=135, h=40, label="Bounded result /\nrequest evidence"),
            dict(id="case", x=185, y=149, w=153, h=40, label="Canonical case: open", fill=CORAL),
            dict(id="human", x=369, y=149, w=119, h=40, label="Human approves\na reviewed choice"),
            dict(id="task", x=344, y=242, w=144, h=36, label="Tasks + evidence"),
            dict(id="verify", x=177, y=242, w=140, h=36, label="Full-domain check"),
            dict(id="done", x=15, y=242, w=133, h=36, label="Resolve + memory", fill=GREEN),
        ], [
            {"from":"start","to":"check"},
            {"from":"check","to":"hold","via":[(83,130)],"label":"Other verdicts","label_at":(88,141)},
            {"from":"check","to":"case","label":"Concrete witness","label_at":(276,133)},
            {"from":"case","to":"human","from_side":"right","to_side":"left"},
            {"from":"human","to":"task","label":"Implementation pending","label_at":(414,219)},
            {"from":"task","to":"verify","from_side":"left","to_side":"right"},
            {"from":"verify","to":"done","from_side":"left","to_side":"right","label":"Complete pass","label_at":(163,235)},
        ]),
        table([
            ["Transition", "Required evidence / result"],
            ["Open a case", "A stored VIOLATED verification with a witness for the same current scenario revision."],
            ["Approve a choice", "Human-selected reviewed option, current case revision and payload-bound command; creates all pending tasks and memory together."],
            ["Complete tasks", "Each task has a current revision and 8-8,000 characters of implementation evidence."],
            ["Verify and resolve", "All tasks complete; adopted rules pass the full finite domain; new source/rule versions and the verification are recorded."],
        ], [.28, .72]),
        p("The normal states are open, implementation_pending, verification_pending and resolved. "
          "A source update can make an older case stale; re-investigate the current evidence rather than silently "
          "applying its old decision. Original source revisions and counterexamples remain inspectable.", "small"),
        source("approveDecision; completeTask; verifyCase; reviewInterpretation in lib/server/service.mjs"),
        PageBreak(),
    ]

    # Page 9: agents and provider modes.
    story += section(8, "Tools that can justify an action",
        "Six strict MCP tools expose the graph and verifier without giving the model arbitrary database authority.")
    story += [
        table([
            ["Tool", "Role", "Operation"],
            ["find_handoffs", "Iris", "Read current handoffs and explicit obligations."],
            ["trace_evidence", "Iris", "Traverse allowed evidence relationships up to 6 hops; return at most 100 paths."],
            ["recall_memory", "Iris", "Read accepted/rejected scenario memory within the current tenant."],
            ["check_obligation", "Cato", "Run deterministic verification; persist result, witness and audit."],
            ["affected_owners", "Vega", "Use native shortestPath to accountable people, bounded to 6 hops."],
            ["open_clarification", "Vega", "Create or join a case for an exact persisted current violation."],
        ], [.29, .12, .59]),
        p("The internal SDK client negotiates with an McpServer over linked InMemoryTransport endpoints. "
          "The transport is local; the application's memory is persisted in FalkorDB. External Streamable HTTP "
          "uses the SDK's stateless server transport and requires both a configured bearer token and a current "
          "signed workspace cookie."),
        table([
            ["Execution mode", "Honest interpretation"],
            ["Guided", "A disclosed policy invokes the same real tools. It makes no LLM request."],
            ["Vercel AI Gateway", "PARALLAX_AI_PROVIDER=vercel-gateway; model openai/gpt-4.1-mini by default; fresh request-time OIDC or optional Gateway key."],
            ["OpenAI-compatible", "Configured HTTPS base URL, LLM_API_KEY and LLM_MODEL; actual provider calls select tools."],
        ], [.30, .70]),
        box("<b>Bounded run:</b> 30 seconds, at most 10 model turns and 12 tool calls. The model cannot choose a graph, "
            "change requested input bounds, approve a human choice or finish implementation through the catalog."),
        p("Missing credentials, account verification, exhausted credits, timeouts and provider errors remain visible. "
          "They are not relabeled as a successful guided/model run. Ordinary chat lookup is guided and read-only; "
          "explicit investigation requests use the configured provider mode.", "small"),
        source("lib/server/mcp.mjs; agents.mjs; model-provider.mjs"),
        PageBreak(),
    ]

    # Page 10: memory.
    story += section(9, "Memory that carries its conditions",
        "What happened, what was agreed and how to resume are distinct records available to every role.")
    story += [
        table([
            ["Kind", "When created", "Meaning"],
            ["Episodic", "A verified violation opens a case.", "The observed witness, affected scenario and clarification event."],
            ["Semantic", "Reviewed fixture scope; human approval; verified adopted mapping.", "The reviewed meaning or decision, including whether implementation is pending."],
            ["Procedural", "Curated baseline; approval-generated follow-up.", "How to investigate or resume the human tasks under recorded conditions."],
        ], [.20, .35, .45]),
        Diagram(229, [
            dict(id="old", x=24, y=20, w=185, h=40, label="Memory for scenario revision 1", fill=GREEN),
            dict(id="source", x=287, y=20, w=194, h=40, label="Human accepts new source"),
            dict(id="r1", x=24, y=106, w=185, h=40, label="Old case / proof remains\nHistorical evidence"),
            dict(id="r2", x=287, y=106, w=194, h=40, label="Handoff revision advances to 2", fill=CORAL),
            dict(id="recall", x=153, y=184, w=199, h=32, label="Recall separates accepted / rejected"),
        ], [
            {"from":"old","to":"r1"},
            {"from":"source","to":"r2"},
            {"from":"r1","to":"recall","via":[(117,166),(253,166)],"label":"Version mismatch","label_at":(107,174)},
            {"from":"r2","to":"recall","via":[(384,166),(253,166)],"label":"Current revision","label_at":(405,174)},
        ]),
        p("Memory applicability is concrete and deliberately coarse: the selected scenario and its recorded "
          "scenario revision must match the current Handoff. The graph selection already supplies visitor/tenant "
          "isolation. Workspace procedures without a scenario revision remain available within that tenant graph."),
        p("An accepted source change creates a new Rule and SourceRevision, links their predecessors, advances "
          "the Handoff revision and marks it unexamined. Old memories remain visible but are rejected for current reuse. "
          "This does not claim vector retrieval, semantic entailment or automatic field-by-field reconciliation."),
        box("<b>Continuity boundary:</b> graph state survives requests and client reconnection. A seven-day visitor "
            "cookie identifies the workspace. Clearing it or changing the signing secret creates another graph context; "
            "organizational login and cross-device account recovery are not included.", fill=PALE),
        source("listMemory; recallMemory; reviewInterpretation; persistMessage; lib/server/session.mjs"),
        PageBreak(),
    ]

    # Page 11: guards.
    story += section(10, "Concurrent work, explicit guards",
        "Correctness lives in conditional graph writes and persistent coordination state.")
    story += [
        Diagram(198, [
            dict(id="a", x=26, y=16, w=181, h=37, label="Reviewer A: case revision 1"),
            dict(id="b", x=298, y=16, w=181, h=37, label="Reviewer B: case revision 1"),
            dict(id="guard", x=141, y=90, w=223, h=42, label="Atomic graph statement\nCheck revision + command + state", fill=GREEN),
            dict(id="ok", x=25, y=160, w=184, h=27, label="One accepted transition", fill=CORAL),
            dict(id="stale", x=298, y=160, w=181, h=27, label="Stale writer: HTTP 409"),
        ], [
            {"from":"a","to":"guard","via":[(117,73),(253,73)]},
            {"from":"b","to":"guard","via":[(389,73),(253,73)]},
            {"from":"guard","to":"ok","via":[(117,145)]},
            {"from":"guard","to":"stale","via":[(389,145)]},
        ]),
        table([
            ["Guard", "Effect"],
            ["Application revision", "The same statement checks the expected item/scenario revision and performs its state change."],
            ["Command + payload hash", "Exact replay returns the stored result. A different payload using the same command is rejected."],
            ["Canonical case identity", "A deterministic scenario/revision ID makes concurrent coordinators converge on one case."],
            ["Lease and fence", "A run has a 65-second lease, private token and increasing fence. Older workers cannot commit after ownership changes."],
        ], [.30, .70]),
        p("FalkorDB documents serialized writers per graph and atomic single-query changes. The implementation "
          "tests its actual engine and groups related decision, task, memory and audit writes in one guarded query. "
          "Application revision properties are unrelated to the GRAPH.QUERY schema-cache version argument. [4]"),
        code("MATCH (activeRun:AgentRun {id:$activeRunId})\nWHERE activeRun.fence=$activeFence\n  AND activeRun.leaseToken=$activeLease\n  AND activeRun.leaseExpiresAt>timestamp()\n  AND activeRun.status='running'"),
        p("Run checkpoints preserve progress for safe retries; no autonomous queue is included. Intake and individual "
          "chat-message appends do not share the exact-once command contract of guarded human transitions. "
          "The application does not claim global exactly-once execution.", "small"),
        source("lib/server/service.mjs; tests/integration.test.mjs; docs/QUERIES.md"),
        PageBreak(),
    ]

    # Page 12: actual UI and design.
    story += section(11, "A calm investigation workspace",
        "Evidence stays readable outside the graph, and every important action has an explicit state.")
    if args.screenshot and args.screenshot.exists():
        shot = Image(str(args.screenshot))
        shot.drawWidth = BODY_W
        shot.drawHeight = BODY_W * shot.imageHeight / shot.imageWidth
        if shot.drawHeight > 321:
            shot.drawHeight = 321
            shot.drawWidth = 321 * shot.imageWidth / shot.imageHeight
        shot.hAlign="CENTER"
        story += [shot, p("Actual application capture from a fresh private synthetic workspace. This image is interface evidence, not a claim of hosted availability.", "caption")]
    else:
        story += [Diagram(242, [
            dict(id="nav", x=12, y=12, w=107, h=216, label="Persistent navigation\n\nHandoffs / Cases\nTasks / Graph\nSources / Memory\nActivity / Audit", fill=GREEN),
            dict(id="hero", x=134, y=12, w=170, h=99, label="Focused handoff\nProblem and next action", fill=CORAL),
            dict(id="evidence", x=319, y=12, w=171, h=99, label="Source and rule evidence\nShared obligation"),
            dict(id="metrics", x=134, y=126, w=356, h=40, label="Measured workspace counts"),
            dict(id="work", x=134, y=181, w=356, h=47, label="Handoff catalog and pending human work"),
        ], []), p("Interface layout diagram; pass --screenshot with a real application capture to include it here.", "caption")]
    story += [
        table([
            ["Surface", "Design purpose"],
            ["Overview / Handoffs", "A focused promise, current graph state, six scenarios and an obvious investigation action."],
            ["Case / Human tasks", "Choice preview, evidence requirements and separate approval, implementation and verification states."],
            ["Graph / Sources / Memory", "Pan, zoom, search, node details, exact source text and current/stale memory reasons."],
            ["Activity / Audit / Settings", "Actual receipts, measured checks, retained transitions and truthful configuration."],
        ], [.33, .67]),
        p("Warm off-white, forest-charcoal navigation, coral emphasis and muted green/teal evidence create a readable "
          "review environment. Text labels carry verdict meaning; color is supplementary. Loading, empty, error, "
          "unknown, incomplete and stale states are explicit. Scenario/tenant-keyed resources prevent old responses "
          "from appearing under a new selection. Mobile navigation collapses and modals manage keyboard focus.", "small"),
        source("components/workspace.tsx; graph-explorer.tsx; ui.tsx; app/globals.css"),
        PageBreak(),
    ]

    # Page 13: API.
    story += section(12, "The application contract",
        "One session-scoped JSON API serves the interface; external MCP uses its own authenticated protocol route.")
    story += [
        table([
            ["Endpoint", "Purpose / required mutation fields"],
            ["GET /api/bootstrap", "Workspace, scenarios, counts, graph status and agent configuration."],
            ["POST /api/workspace", "tenant (acme/nova), optional reset for this visitor/company graph."],
            ["GET /api/graph", "Optional scenarioId and q; typed nodes/edges and source matches."],
            ["GET /api/scenarios/:id", "Current sources/rules, obligation, bounds, owners and history."],
            ["POST /api/investigate", "scenarioId, optional inputs and stable commandId for retries."],
            ["GET /api/cases or /api/cases/:id", "Case list or choices, tasks, evidence, decisions and history."],
            ["POST /api/cases/:id/decision", "choice, optional note, expectedRevision, commandId."],
            ["POST /api/tasks/:id/complete", "evidence, expectedRevision, commandId."],
            ["POST /api/cases/:id/verify", "expectedRevision, commandId; full-domain repair verification."],
            ["GET /api/tasks, /api/sources", "Task board; source revisions and interpretations."],
            ["POST /api/intake", "text, scenarioId, departmentId, optional choiceId."],
            ["POST /api/interpretations/:id/review", "accept/reject action, expectedRevision, commandId."],
            ["GET /api/memory, /api/runs, /api/audit", "Memory applicability, durable receipts and transitions."],
            ["GET / POST /api/chat", "Persisted history; message, optional scenarioId and commandId."],
            ["GET / POST /api/verification", "Latest actual report / isolated measured lab."],
            ["GET /api/health", "Actual graph status and provider configuration; no secrets."],
            ["POST /api/mcp", "External MCP bearer token plus valid workspace session cookie."],
        ], [.45, .55]),
        code('{"ok":true,"data":{...}}\n{"ok":false,"error":{"code":"REVISION_CONFLICT",\n  "message":"Reload to review the current version."}}'),
        p("API responses are private/no-store. JSON request text is capped at 32,768 characters; domain fields have "
          "smaller limits. Lease tokens, payload hashes, visitor IDs and graph names are removed recursively. "
          "See docs/ARCHITECTURE.md for complete payload details.", "small"),
        PageBreak(),
    ]

    # Page 14: operations.
    story += section(13, "Deploy, observe and recover",
        "A working web build and a live, persistent graph are separate release conditions.")
    story += [
        table([
            ["Selected FalkorDB Cloud route", "Vercel application"],
            ["Use the actual provisioned instance's hostname, assigned port, username and password.",
             "Import the Next.js repository. Node 24; npm ci --include=dev; npm run build."],
            ["Choose a TLS-enabled endpoint for the public production connection; confirm the actual storage guarantees.",
             "Set FALKORDB_HOST, PORT, USERNAME, PASSWORD and TLS=true; use each variable's FALKORDB_ prefix."],
            ["Set FALKORDB_PERSISTENCE=managed only after confirming persistence. The flag provisions nothing.",
             "Omit FALKORDB_HTTP_URL and FALKORDB_SOCKET. Keep a unique private PARALLAX_SESSION_SECRET."],
            ["Use the provider's supported restart, backup, retention and restore procedures. Plan features vary.",
             "Select explicit guided, Gateway or direct model mode. Configure external MCP only when needed."],
        ], [.5, .5]),
        p("Health and durability are different", "h2"),
        table([
            ["Check", "What it establishes"],
            ["Application health + engine status", "The deployed app reaches FalkorDB; inspect available module and persistence evidence."],
            ["Create, reload and resume", "The full browser -> API -> graph -> response workflow succeeds."],
            ["Hosted restart, retained storage", "The selected deployment lifecycle retains a disposable marker and pending work."],
            ["Independent restore drill", "A saved snapshot/log set recovers the expected application records."],
        ], [.40, .60]),
        p("<b>Local Docker workflow.</b> Compose pairs PARALLAX with the official FalkorDB image, its graph browser "
          "and a named data volume. The app opens at localhost:3000; FalkorDB Browser opens at localhost:3002. "
          "Run from the repository root with Docker available:"),
        code("node scripts/docker-setup.mjs\n"
             "docker compose --env-file .env.docker.local up --build --wait"),
        p("Docker execution on the user's computer and in this environment remains unverified; no Docker daemon "
          "is available here. See deploy/local/README.md for health, graph inspection and same-volume restart "
          "checks. Ordinary compose down retains the data volume.", "small"),
        box("<b>Identity matters during recovery.</b> The visitor cookie and stable signing secret choose the graph. "
            "Rotating that secret invalidates cookies and changes derived graph names. An old graph is not automatically "
            "recovered by a new anonymous session.", fill=AMBER),
        p("Hosting allowance, credits and retention depend on the connected account. The deployment does not imply "
          "a permanent paid service. Exact current settings, rotation, troubleshooting and backup guidance are in "
          "docs/OPERATIONS.md. Cloud capabilities must match the actual selected instance; self-host settings "
          "are in the optional gateway guide. [6, 7, 10]", "small"),
        PageBreak(),
    ]

    # Page 15: real evidence.
    lab_count = str(summary.get("passed", "Run"))
    lab_detail = f'{summary.get("passed", 0)}/{summary.get("total", 0)} measured checks' if report else "No saved report"
    test_value = str(args.passed_tests) if args.passed_tests else "Tests"
    test_detail = "release checkpoint passed" if args.passed_tests else "run npm test"
    story += section(14, "Verification that can be repeated",
        "Behavioral checks use the actual engine. The lab reports observed work and its environment.")
    story += [
        Metrics([(test_value, "AUTOMATED SUITE", test_detail),
                 (lab_count, "VERIFICATION LAB", lab_detail),
                 (str(concurrency.get("workers", 16)), "CONCURRENT WORKERS", "8 writes per worker")]),
        Spacer(1, 13),
        table([
            ["Measured quantity", "Saved lab observation"],
            ["Transport", html.escape(connection.get("transport", "No measurement recorded"))],
            ["Accepted writes / reads", f'{concurrency.get("acceptedWrites", "unrun")} / {concurrency.get("readOperations", "unrun")}'],
            ["Stored receipts / final counter", f'{concurrency.get("storedReceipts", "unrun")} / {concurrency.get("counterValue", "unrun")}'],
            ["Guarded approval / stale rejections", f'{concurrency.get("guardedWrites", "unrun")} / {concurrency.get("staleRejected", "unrun")}'],
            ["Lost acknowledged writes / duplicate cases", f'{concurrency.get("lostAcknowledgedWrites", "unrun")} / {concurrency.get("duplicateCases", "unrun")}'],
            ["Write latency p50 / p95", f'{concurrency.get("p50Ms", "unrun")} ms / {concurrency.get("p95Ms", "unrun")} ms'],
            ["Recorded timestamp", html.escape(report.get("createdAt", "Not run"))],
        ], [.49, .51]),
        p("These latency figures describe the saved run, including its transport. They are not a hosted-network "
          "benchmark or a capacity guarantee. This report's persistence description is: <b>" +
          html.escape(connection.get("persistence", "not measured")) + "</b>.", "small"),
        table([
            ["Coverage", "What is tested"],
            ["Domain and controls", "Concrete arithmetic, all four verdicts, units, invalid/injection-like input, bounds and equivalent meanings."],
            ["Graph and coordination", "Typed paths, current-rule owner/event provenance, native shortestPath, revision conflicts, replay, task evidence, source history and isolation."],
            ["Protocol and workers", "Actual MCP negotiation, provider bounds/errors, gateway operations, read-only enforcement and stale-worker fencing."],
        ], [.31, .69]),
        p("The 15-check lab creates separate temporary fixture graphs, then removes them; only the report is stored "
          "in the caller's graph. The integration suite also exercises an orderly local engine AOF restart. Client "
          "reconnection, local restart, hosted restart and backup recovery are distinct claims."),
        code("npm test\nnpm run typecheck\nnpm run build\nnpm run verify"),
        source("reports/verification.json; tests/; lib/server/verification.mjs"),
        PageBreak(),
    ]

    # Page 16: limits and reference map.
    story += section(15, "A clear operating boundary",
        "The application is complete for its synthetic workflow. Real organizational adoption has explicit next requirements.")
    story += [
        table([
            ["Current boundary", "Next production requirement"],
            ["Curated finite mappings", "Consented connector ingestion and reviewable structured extraction for unrestricted sources."],
            ["Visitor/company cookie identity", "Authenticated membership, organizational SSO, roles and cross-device recovery."],
            ["Submitted implementation evidence", "Independent evidence validation or consented integration with the target system."],
            ["One persistent graph service", "Backups, restore drills, availability design, retention and realistic capacity testing."],
            ["Bounded request orchestration", "A durable queue/scheduler for autonomous retries and long-running background work."],
        ], [.38, .62]),
        p("FalkorDB resources used", "h2"),
        p("Official client and Lite packaging; typed Cypher relationships; parameterized read/write queries; "
          "GRAPH.RO_QUERY; bounded traversals and native shortestPath; range/full-text indexes; uniqueness; "
          "AOF and engine health. The official MCP ecosystem informs the scoped tool design. GraphRAG SDK, "
          "vector retrieval and LangChain are documented options for extending the retrieval pipeline."),
        p("Repository reading map", "h2"),
        p("<b>README.md</b> - setup and walkthrough. <b>docs/ARCHITECTURE.md</b> - complete schema, workflow and API. "
          "<b>docs/QUERIES.md</b> - executable read patterns and guarded writes. <b>docs/OPERATIONS.md</b> - deployment "
          "and recovery. <b>deploy/gateway/README.md</b> - exact host settings. <b>reports/PROGRESS.md</b> - actual "
          "release URLs, commit and verification evidence."),
        p("Primary references", "h2"),
        p('[1] <link href="https://github.com/FalkorDB/falkordb-ts">Official Node client</link> / '
          '[2] <link href="https://github.com/FalkorDB/falkordblite-ts">Official Lite package</link><br/>'
          '[3] <link href="https://docs.falkordb.com/cypher/functions">FalkorDB Cypher functions</link> / '
          '[4] <link href="https://docs.falkordb.com/design/concurrency">FalkorDB concurrency</link><br/>'
          '[5] <link href="https://modelcontextprotocol.io/docs/sdk">Official MCP SDKs</link> / '
          '[6] <link href="https://docs.railway.com/volumes">Railway volumes</link><br/>'
          '[7] <link href="https://vercel.com/docs/functions/runtimes/node-js">Vercel Node runtime</link> / '
          '[8] <link href="https://vercel.com/docs/ai-gateway/authentication-and-byok">AI Gateway authentication</link><br/>'
          '[9] <link href="https://www.wemakedevs.org/hackathons/falkordb/resources">Graph Hacks sponsor resources</link> / '
          '[10] <link href="https://www.falkordb.com/plans/">FalkorDB Cloud plan capabilities</link>', "small"),
        box('<b>Release checkpoint - 18 October 2026</b><br/>'
            'Source: <link href="https://github.com/ayushmanthehero-lab/Parallax">'
            'github.com/ayushmanthehero-lab/Parallax</link><br/>'
            'Web: <link href="https://parallax-graph-sigma.vercel.app">parallax-graph-sigma.vercel.app</link> '
            '- public homepage HTTP 200.<br/>'
            'Graph API: 503 DATABASE_NOT_CONFIGURED pending the selected FalkorDB Cloud connection. '
            'Local workflow verified; Cloud provisioning and hosted workflow remain unconfirmed. See the release record for updates.', fill=PALE),
    ]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUT), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=55, bottomMargin=46, title="PARALLAX - Architecture, Workflow and Design",
        author="PARALLAX project", subject="Graph Hacks Track 01 and Track 02 implementation guide",
        pageCompression=1,
    )
    frame = Frame(MARGIN, 46, BODY_W, PAGE_H-101, leftPadding=0, rightPadding=0,
                  topPadding=0, bottomPadding=0, id="body")
    doc.addPageTemplates(PageTemplate(id="main", frames=[frame], onPage=on_page))
    doc.build(story)
    reader = PdfReader(OUT)
    page_count = len(reader.pages)
    if page_count != 16:
        raise RuntimeError(f"Expected 16 designed pages, rendered {page_count}. Inspect layout before delivery.")
    for index, page in enumerate(reader.pages, 1):
        text = page.extract_text() or ""
        if len(text.strip()) < 150:
            raise RuntimeError(f"Page {index} has unexpectedly little extractable text.")
    print(json.dumps({"output": str(OUT), "pages": page_count, "bytes": OUT.stat().st_size}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--screenshot", type=Path, help="Real overview screenshot, optional")
    parser.add_argument("--passed-tests", type=int, help="Observed passing suite count for this release checkpoint")
    build(parser.parse_args())

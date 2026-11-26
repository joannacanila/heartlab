"""Convert documentation/HEARTLAB_Research_Documentation.md into an editable, formatted DOCX.

Handles the Markdown subset used in that file: headings, paragraphs, bullet and numbered lists,
block quotes, pipe tables, images, fenced code, and **bold** / *italic* / `code` inline.
Course format: Times New Roman, 12 pt body, 14 pt headings.
"""
import re
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, Inches, RGBColor

DOC_DIR = Path(__file__).resolve().parents[1] / "documentation"
SRC = DOC_DIR / "HEARTLAB_Research_Documentation.md"
OUT = DOC_DIR / "HEARTLAB_Research_Documentation.docx"
FONT = "Times New Roman"
INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)")


def set_font(run, size=None, bold=None, italic=None, mono=False, color=None):
    name = "Consolas" if mono else FONT
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size: run.font.size = Pt(size)
    if bold is not None: run.bold = bold
    if italic is not None: run.italic = italic
    if color: run.font.color.rgb = RGBColor.from_string(color)


def add_inline(par, text, size=12, base_italic=False):
    for part in INLINE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**"):
            r = par.add_run(part[2:-2]); set_font(r, size, bold=True, italic=base_italic)
            if "PENDING" in part or "GROUP" in part:
                r.font.highlight_color = 7  # yellow: needs the group's attention
        elif part.startswith("`") and part.endswith("`"):
            r = par.add_run(part[1:-1]); set_font(r, size - 1.5, mono=True)
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            r = par.add_run(part[1:-1]); set_font(r, size, italic=True)
        else:
            r = par.add_run(part); set_font(r, size, italic=base_italic)


def shade(cell, hex_fill):
    tcPr = cell._element.get_or_add_tcPr()
    shd = OxmlElement("w:shd"); shd.set(qn("w:val"), "clear"); shd.set(qn("w:color"), "auto"); shd.set(qn("w:fill"), hex_fill)
    tcPr.append(shd)


def add_table(doc, rows):
    header, body = rows[0], rows[2:] if len(rows) > 1 and set(rows[1][0]) <= set("-: ") else rows[1:]
    t = doc.add_table(rows=1 + len(body), cols=len(header))
    t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate([header] + body):
        for j in range(len(header)):
            cell = t.cell(i, j)
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            add_inline(p, row[j] if j < len(row) else "", size=10)
            if i == 0:
                for r in p.runs: r.bold = True
                shade(cell, "E9EBEF")
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def build():
    lines = SRC.read_text(encoding="utf-8").splitlines()
    doc = Document()
    sec = doc.sections[0]
    for side in ("left_margin", "right_margin", "top_margin", "bottom_margin"):
        setattr(sec, side, Inches(1))
    st = doc.styles["Normal"]; st.font.name = FONT; st.font.size = Pt(12)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    for lvl, size in ((1, 16), (2, 14), (3, 12.5)):
        hs = doc.styles[f"Heading {lvl}"]; hs.font.name = FONT; hs.font.size = Pt(size); hs.font.bold = True
        hs.font.color.rgb = RGBColor(0x1D, 0x24, 0x30); hs.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)

    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        s = line.strip()
        if not s or s == "---":
            i += 1; continue
        if s.startswith("```"):
            block = []; i += 1
            while i < n and not lines[i].strip().startswith("```"):
                block.append(lines[i]); i += 1
            i += 1
            p = doc.add_paragraph(); p.paragraph_format.left_indent = Inches(0.25)
            r = p.add_run("\n".join(block)); set_font(r, 9, mono=True)
            continue
        m = re.match(r"^(#{1,3})\s+(.*)", s)
        if m:
            level = len(m.group(1))
            if level == 1:
                p = doc.add_paragraph(); p.alignment = WD_ALIGN_PARAGRAPH.CENTER
                r = p.add_run(m.group(2)); set_font(r, 18, bold=True)
            else:
                h = doc.add_heading(level=level - 1); add_inline(h, m.group(2), size=14 if level == 2 else 12.5)
                for r in h.runs: r.bold = True
            i += 1; continue
        m = re.match(r"^!\[(.*)\]\((.*)\)", s)
        if m:
            img = DOC_DIR / m.group(2)
            if img.exists():
                doc.add_picture(str(img), width=Inches(6.3))
                doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
            cap = doc.add_paragraph(); cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
            add_inline(cap, m.group(1), size=10, base_italic=True)
            i += 1; continue
        if s.startswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")]); i += 1
            add_table(doc, rows); continue
        if s.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip().lstrip(">").strip()); i += 1
            p = doc.add_paragraph(); p.paragraph_format.left_indent = Inches(0.35)
            p.paragraph_format.right_indent = Inches(0.2)
            add_inline(p, " ".join(b for b in buf if b), size=11, base_italic=False)
            continue
        m = re.match(r"^(-|\d+\.)\s+(.*)", s)
        if m:
            if m.group(1) == "-":
                p = doc.add_paragraph(style="List Bullet"); add_inline(p, m.group(2))
            else:  # literal numbers: Word's auto-numbering would continue across separate lists
                p = doc.add_paragraph(); add_inline(p, f"{m.group(1)}\t{m.group(2)}")
                p.paragraph_format.left_indent = Inches(0.35); p.paragraph_format.first_line_indent = Inches(-0.3)
                p.paragraph_format.tab_stops.add_tab_stop(Inches(0.35))
            p.paragraph_format.space_after = Pt(2)
            i += 1; continue
        buf = [s]; i += 1
        while i < n and lines[i].strip() and not re.match(r"^(#|\||>|-\s|\d+\.\s|!\[|```)", lines[i].strip()):
            buf.append(lines[i].strip()); i += 1
        p = doc.add_paragraph(); add_inline(p, " ".join(buf))
        p.paragraph_format.space_after = Pt(6)
    doc.core_properties.title = "HEARTLAB Research Documentation"
    doc.save(OUT)
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    build()

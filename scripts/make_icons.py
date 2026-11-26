"""Render the browser-tab and touch icons in app/frontend/icons/ from the HEARTLAB mark (ECG trace + data point).

Run once after changing the mark:  .venv/bin/python scripts/make_icons.py   (needs Playwright Chromium and Pillow)
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image
OUT = Path(__file__).resolve().parents[1] / "app" / "frontend" / "icons"
TRACE = '<path d="M2.5 20h7l2.2-3.6 2.6 6.6L18 8.8l3 11.2h8.5" fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/><circle cx="18" cy="7.4" r="{r}" fill="#ff4d64"/>'
def tile(size, pad):
    # dark rounded tile; the mark scaled into the inner box
    inner = 32 / (1 - 2 * pad)
    off = -pad * inner
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="{off} {off} {inner} {inner}">'
            f'<rect x="{off}" y="{off}" width="{inner}" height="{inner}" rx="{inner*0.22}" fill="#0d0f16"/>'
            + TRACE.format(c="#eceef4", w=2.6, r=3.1) + '</svg>')
def bare(size):  # small favicon: transparent, heavier stroke so it survives 16 px
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 32 32">'
            f'<rect width="32" height="32" rx="7" fill="#0d0f16"/>' + TRACE.format(c="#eceef4", w=3.2, r=3.6) + '</svg>')
jobs = {"apple-touch-icon.png": tile(180, .14), "icon-192.png": tile(192, .14), "icon-512.png": tile(512, .14),
        "favicon-32.png": bare(32), "favicon-16.png": bare(16), "favicon-48.png": bare(48)}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    for name, svg in jobs.items():
        size = int(svg.split('width="')[1].split('"')[0])
        pg.set_viewport_size({"width": size, "height": size})
        pg.set_content(f'<html><body style="margin:0;background:transparent">{svg}</body></html>')
        pg.locator("svg").screenshot(path=str(OUT / name), omit_background=True)
    b.close()
imgs = [Image.open(OUT / f"favicon-{s}.png").convert("RGBA") for s in (16, 32, 48)]
imgs[2].save(OUT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=imgs[:2])
(OUT / "favicon-16.png").unlink(); (OUT / "favicon-48.png").unlink()
print(sorted(x.name for x in OUT.iterdir()))

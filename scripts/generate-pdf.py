#!/usr/bin/env python3
"""
Generate a resume PDF from an HTML file using Playwright.

Header: date right-aligned.
Footer: page number centered.
No filename or URL shown anywhere.

Usage: python3 generate-pdf.py <input.html> <output.pdf>
"""

import sys
from pathlib import Path
from playwright.sync_api import sync_playwright


HEADER = (
    '<div style="box-sizing:border-box;width:100%;padding:0 0.65in;'
    'font-size:8px;color:#888;font-family:Arial,sans-serif;text-align:right;">'
    '<span class="date"></span></div>'
)

FOOTER = (
    '<div style="box-sizing:border-box;width:100%;padding:0 0.65in;'
    'font-size:8px;color:#888;font-family:Arial,sans-serif;text-align:center;">'
    '<span class="pageNumber"></span></div>'
)


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.html> <output.pdf>", file=sys.stderr)
        sys.exit(1)

    html_path = Path(sys.argv[1]).resolve()
    output_path = sys.argv[2]

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(f"file://{html_path}", wait_until="networkidle")
        page.pdf(
            path=output_path,
            format="Letter",
            print_background=True,
            display_header_footer=True,
            header_template=HEADER,
            footer_template=FOOTER,
            # Top/bottom margins include header/footer rendering area.
            # Left/right match @page margins in resume.css.
            margin={"top": "0.65in", "bottom": "0.6in", "left": "0.65in", "right": "0.65in"},
        )
        browser.close()

    print(f"PDF generated: {output_path}")


if __name__ == "__main__":
    main()

import argparse
from pathlib import Path
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser(description="Create four-page visual QA sheets from rendered PDF pages.")
parser.add_argument(
    "source",
    nargs="?",
    type=Path,
    default=Path("output/pdf/applications_2026-08-24_linkedin/rendered"),
)
args = parser.parse_args()

source = args.source
target = source.parent / "qa_sheets"
target.mkdir(parents=True, exist_ok=True)
files = sorted(source.glob("*.png"))

for batch_no in range(0, len(files), 4):
    batch = files[batch_no : batch_no + 4]
    sheet = Image.new("RGB", (1240, 1620), "#d9e2ea")
    draw = ImageDraw.Draw(sheet)
    for index, path in enumerate(batch):
        with Image.open(path) as page:
            page = page.convert("RGB")
            page.thumbnail((590, 760))
            x = 20 + (index % 2) * 610
            y = 20 + (index // 2) * 800
            sheet.paste(page, (x, y))
            draw.text((x, y + page.height + 4), path.stem[:78], fill="#142033")
    sheet.save(target / f"qa_sheet_{batch_no // 4 + 1:02}.png")

print(f"Created {(len(files) + 3) // 4} QA sheets in {target}")

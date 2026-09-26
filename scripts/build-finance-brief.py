import json
import os
from pathlib import Path
from textwrap import wrap

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "diagnostics" / "finance" / "api-finance-latest.json"
OUTPUT = ROOT / "output" / "pdf" / "myaipa-finance-brief-2026-ytd.pdf"

PAGE_W, PAGE_H = letter
MARGIN = 42

NAVY = HexColor("#102A43")
BLUE = HexColor("#2563EB")
PALE_BLUE = HexColor("#EAF2FF")
GREEN = HexColor("#12805C")
PALE_GREEN = HexColor("#E8F7F1")
ORANGE = HexColor("#C75B12")
PALE_ORANGE = HexColor("#FFF1E6")
RED = HexColor("#B42318")
PALE_RED = HexColor("#FDECEC")
INK = HexColor("#172B4D")
MUTED = HexColor("#5B6B7A")
LINE = HexColor("#D8E1EA")
PAPER = HexColor("#F7F9FC")


def money(value):
    return f"${float(value or 0):,.2f}"


def ascii_mask(value):
    return str(value or "").replace("•", "*")


def text(c, x, y, value, size=10, color=INK, font="Helvetica"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, str(value))


def right_text(c, x, y, value, size=10, color=INK, font="Helvetica"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawRightString(x, y, str(value))


def wrapped_text(c, x, y, value, width_chars=78, size=10, leading=14, color=INK, font="Helvetica"):
    for line in wrap(str(value), width=width_chars):
        text(c, x, y, line, size=size, color=color, font=font)
        y -= leading
    return y


def rounded_box(c, x, y, width, height, fill, stroke=LINE, radius=10):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def header(c, kicker, title, subtitle, page_number):
    text(c, MARGIN, PAGE_H - 38, kicker.upper(), 8.5, BLUE, "Helvetica-Bold")
    text(c, MARGIN, PAGE_H - 66, title, 23, NAVY, "Helvetica-Bold")
    text(c, MARGIN, PAGE_H - 84, subtitle, 9.5, MUTED)
    right_text(c, PAGE_W - MARGIN, PAGE_H - 38, f"PAGE {page_number} OF 2", 8, MUTED, "Helvetica-Bold")


def footer(c, page_number):
    c.setStrokeColor(LINE)
    c.line(MARGIN, 30, PAGE_W - MARGIN, 30)
    text(c, MARGIN, 17, "MyAIPA finance brief - read-only API report - USD", 7.5, MUTED)
    right_text(c, PAGE_W - MARGIN, 17, f"{page_number}/2", 7.5, MUTED)


def metric_card(c, x, y, width, label, value, note, fill, accent):
    rounded_box(c, x, y, width, 74, fill, stroke=fill)
    text(c, x + 12, y + 53, label.upper(), 7.5, accent, "Helvetica-Bold")
    text(c, x + 12, y + 29, value, 19, NAVY, "Helvetica-Bold")
    text(c, x + 12, y + 12, note, 8, MUTED)


def draw_bar(c, x, y, label, amount, maximum, width=330, warn=False):
    label_width = 180
    bar_x = x + label_width
    bar_width = width - label_width
    text(c, x, y + 4, label, 9, INK, "Helvetica-Bold" if warn else "Helvetica")
    rounded_box(c, bar_x, y, bar_width, 11, HexColor("#EDF1F5"), stroke=HexColor("#EDF1F5"), radius=5)
    filled = 0 if maximum <= 0 else max(3, (amount / maximum) * bar_width)
    rounded_box(c, bar_x, y, filled, 11, ORANGE if warn else BLUE, stroke=ORANGE if warn else BLUE, radius=5)
    right_text(c, PAGE_W - MARGIN, y + 3, money(amount), 9.5, NAVY, "Helvetica-Bold")


def bullet(c, x, y, title, body, color=BLUE):
    c.setFillColor(color)
    c.circle(x + 4, y + 4, 3, fill=1, stroke=0)
    text(c, x + 16, y, title, 10, NAVY, "Helvetica-Bold")
    return wrapped_text(c, x + 16, y - 15, body, width_chars=72, size=9, leading=12, color=MUTED)


def main():
    if not SOURCE.exists():
        raise SystemExit(f"Finance report not found: {SOURCE}")

    report = json.loads(SOURCE.read_text(encoding="utf-8"))
    allocation = report.get("businessAllocation") or {}
    drivers = {item["label"]: item for item in allocation.get("costDrivers", [])}
    businesses = allocation.get("businesses", [])
    inventory = allocation.get("phoneInventory") or {}
    unallocated = allocation.get("unallocated") or {}
    account_total = float(allocation.get("accountTotalUsd") or 0)
    number_rent = float(drivers.get("Phone-number rental", {}).get("amountUsd") or 0)
    twilio_use = float(drivers.get("Twilio calls, texts, media, and other usage", {}).get("amountUsd") or 0)
    vapi = float(drivers.get("Vapi AI call processing", {}).get("amountUsd") or 0)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=letter)
    c.setTitle("MyAIPA Finance Brief - 2026 YTD")
    c.setAuthor("MyAIPA")

    # Page 1: designed to stand alone when printed.
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    header(
        c,
        "Money snapshot",
        "Where the money went",
        "2026 YTD - rolling 240-day API window through Aug. 28, 2026",
        1,
    )

    rounded_box(c, MARGIN, PAGE_H - 164, PAGE_W - 2 * MARGIN, 58, white, stroke=LINE)
    text(c, MARGIN + 14, PAGE_H - 129, "KNOWN PROVIDER COST", 8, MUTED, "Helvetica-Bold")
    text(c, MARGIN + 14, PAGE_H - 153, money(account_total), 25, NAVY, "Helvetica-Bold")
    text(c, MARGIN + 166, PAGE_H - 149, "The bill is high because of phone-number rent, not heavy calling.", 10, INK, "Helvetica-Bold")

    gap = 10
    card_w = (PAGE_W - 2 * MARGIN - 2 * gap) / 3
    card_y = PAGE_H - 252
    metric_card(c, MARGIN, card_y, card_w, "Phone numbers", money(number_rent), "86.6% of total", PALE_ORANGE, ORANGE)
    metric_card(c, MARGIN + card_w + gap, card_y, card_w, "Twilio use", money(twilio_use), "Calls, texts, media", PALE_BLUE, BLUE)
    metric_card(c, MARGIN + 2 * (card_w + gap), card_y, card_w, "Vapi", money(vapi), "AI call processing", PALE_GREEN, GREEN)

    text(c, MARGIN, PAGE_H - 280, "BUSINESS-BY-BUSINESS SPLIT", 9, NAVY, "Helvetica-Bold")
    text(c, MARGIN, PAGE_H - 295, "Assigned using the current business and phone mappings.", 8.5, MUTED)
    bar_y = PAGE_H - 322
    bar_rows = [(row.get("businessName", "Unknown"), float(row.get("allocatedTotalUsd") or 0), False) for row in businesses]
    bar_rows.append(("Unallocated or shared", float(allocation.get("unallocatedTotalUsd") or 0), True))
    maximum = max((amount for _, amount, _ in bar_rows), default=1)
    for label, amount, warn in bar_rows:
        short_label = label if len(label) <= 31 else label[:28] + "..."
        draw_bar(c, MARGIN, bar_y, short_label, amount, maximum, warn=warn)
        bar_y -= 28

    rounded_box(c, MARGIN, 92, PAGE_W - 2 * MARGIN, 96, PALE_ORANGE, stroke=HexColor("#FFD3AD"))
    text(c, MARGIN + 14, 166, "THE PLAIN-ENGLISH ANSWER", 8, ORANGE, "Helvetica-Bold")
    y = wrapped_text(
        c,
        MARGIN + 14,
        147,
        f"Twilio reports {int(inventory.get('billedNumberUnits') or 0)} billed number units at about {money(inventory.get('impliedUnitCostUsd'))} each. "
        f"Only {money(twilio_use + vapi)} came from calls, texts, media, and Vapi. "
        f"The remaining cost is mainly rental for phone numbers held during the year.",
        width_chars=94,
        size=10,
        leading=14,
        color=INK,
    )
    text(c, MARGIN + 14, y - 4, "Bottom line: number inventory is the first place to control costs.", 10, NAVY, "Helvetica-Bold")
    footer(c, 1)
    c.showPage()

    # Page 2: stacked sections that remain readable on a phone.
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    header(
        c,
        "Action page",
        "What needs attention next",
        "Short sections for phone reading; each action remains approval-gated",
        2,
    )

    rounded_box(c, MARGIN, PAGE_H - 174, PAGE_W - 2 * MARGIN, 68, PALE_RED, stroke=HexColor("#F7C3C0"))
    text(c, MARGIN + 14, PAGE_H - 128, "UNASSIGNED OR SHARED COST", 8, RED, "Helvetica-Bold")
    text(c, MARGIN + 14, PAGE_H - 155, money(allocation.get("unallocatedTotalUsd")), 23, NAVY, "Helvetica-Bold")
    text(c, MARGIN + 160, PAGE_H - 148, f"{len(inventory.get('unassignedActiveNumbers') or [])} of {int(inventory.get('activeNumbers') or 0)} active numbers are not assigned to a business.", 10, INK, "Helvetica-Bold")
    text(c, MARGIN + 160, PAGE_H - 164, "Do not cancel them until ownership is verified.", 9, RED)

    y = PAGE_H - 212
    text(c, MARGIN, y, "NUMBERS TO REVIEW", 9, NAVY, "Helvetica-Bold")
    y -= 22
    chips = list(inventory.get("unassignedActiveNumbers") or [])
    chip_x = MARGIN
    for item in chips:
        rounded_box(c, chip_x, y - 6, 74, 25, PALE_BLUE, stroke=HexColor("#C9DBFF"), radius=7)
        text(c, chip_x + 13, y + 2, ascii_mask(item), 10, NAVY, "Helvetica-Bold")
        chip_x += 82
        if chip_x + 74 > PAGE_W - MARGIN:
            chip_x = MARGIN
            y -= 34
    y -= 34
    shared = ", ".join(ascii_mask(item) for item in (inventory.get("sharedPhoneNumbers") or [])) or "None"
    rounded_box(c, MARGIN, y - 24, PAGE_W - 2 * MARGIN, 48, PALE_ORANGE, stroke=HexColor("#FFD3AD"))
    text(c, MARGIN + 12, y + 7, "SHARED MAPPING", 8, ORANGE, "Helvetica-Bold")
    text(c, MARGIN + 12, y - 10, f"{shared} appears under more than one business. Decide the correct owner first.", 9.5, INK)

    y -= 62
    text(c, MARGIN, y, "DO THESE IN ORDER", 9, NAVY, "Helvetica-Bold")
    y -= 28
    y = bullet(c, MARGIN, y, "1. Fix ownership", "Assign the six unassigned numbers and resolve the shared number mapping. This makes future business reports trustworthy.") - 12
    y = bullet(c, MARGIN, y, "2. Review number inventory", "After ownership is confirmed, identify numbers with no live customer, routing, or recent activity. Cancellation still requires approval.", GREEN) - 12
    y = bullet(c, MARGIN, y, "3. Deploy the read-only finance endpoint", "This adds Stripe balance transactions, fees, refunds, and payouts to the same report without moving money.", ORANGE) - 12
    y = bullet(c, MARGIN, y, "4. Connect settlement data", "Authorize a read-only bank and card feed so provider charges can be matched to money that actually left the account.", RED) - 12

    rounded_box(c, MARGIN, 79, PAGE_W - 2 * MARGIN, 76, PALE_GREEN, stroke=HexColor("#BDE8D8"))
    text(c, MARGIN + 14, 134, "WHAT GOOD LOOKS LIKE", 8, GREEN, "Helvetica-Bold")
    text(c, MARGIN + 14, 115, "Every number has one owner. Every provider charge has one category.", 10.5, NAVY, "Helvetica-Bold")
    text(c, MARGIN + 14, 98, "The weekly report then shows cost per business, unused inventory, and approvals in under one minute.", 9, INK)
    text(c, MARGIN + 14, 84, "Current rent run rate for 12 numbers at about $1.15 each: roughly $13.80 per month.", 8.5, MUTED)
    footer(c, 2)

    c.save()
    print(str(OUTPUT))


if __name__ == "__main__":
    main()

import json
from pathlib import Path
from textwrap import wrap

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent.parent
ADMIN_SOURCE = ROOT / "diagnostics" / "admin" / "stats-latest.json"
FINANCE_SOURCE = ROOT / "diagnostics" / "finance" / "api-finance-latest.json"
OUTPUT = ROOT / "output" / "pdf" / "myaipa-boss-brief-2026-08-28.pdf"

PAGE_W, PAGE_H = letter
MARGIN = 40
TOTAL_PAGES = 5

NAVY = HexColor("#102A43")
BLUE = HexColor("#2563EB")
PALE_BLUE = HexColor("#EAF2FF")
GREEN = HexColor("#12805C")
PALE_GREEN = HexColor("#E8F7F1")
YELLOW = HexColor("#B45309")
PALE_YELLOW = HexColor("#FFF4D6")
RED = HexColor("#B42318")
PALE_RED = HexColor("#FDECEC")
INK = HexColor("#172B4D")
MUTED = HexColor("#5B6B7A")
LINE = HexColor("#D8E1EA")
PAPER = HexColor("#F7F9FC")


def money(value):
    return f"${float(value or 0):,.2f}"


def text(c, x, y, value, size=10, color=INK, font="Helvetica"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, str(value))


def right_text(c, x, y, value, size=10, color=INK, font="Helvetica"):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawRightString(x, y, str(value))


def wrapped(c, x, y, value, width_chars=78, size=9, leading=12, color=INK, font="Helvetica"):
    lines = wrap(str(value), width=width_chars) or [""]
    for line in lines:
        text(c, x, y, line, size=size, color=color, font=font)
        y -= leading
    return y


def rounded_box(c, x, y, width, height, fill, stroke=LINE, radius=10):
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def page_header(c, kicker, title, subtitle, page):
    text(c, MARGIN, PAGE_H - 35, kicker.upper(), 8.2, BLUE, "Helvetica-Bold")
    text(c, MARGIN, PAGE_H - 62, title, 22, NAVY, "Helvetica-Bold")
    text(c, MARGIN, PAGE_H - 80, subtitle, 9.2, MUTED)
    right_text(c, PAGE_W - MARGIN, PAGE_H - 35, f"PAGE {page} OF {TOTAL_PAGES}", 8, MUTED, "Helvetica-Bold")


def footer(c, page):
    c.setStrokeColor(LINE)
    c.line(MARGIN, 29, PAGE_W - MARGIN, 29)
    text(c, MARGIN, 16, "MyAIPA boss brief - live read-only API data - USD", 7.3, MUTED)
    right_text(c, PAGE_W - MARGIN, 16, f"Prepared Aug. 28, 2026 | {page}/{TOTAL_PAGES}", 7.3, MUTED)


def status_row(c, y, label, status, evidence, status_fill, status_color):
    rounded_box(c, MARGIN, y, PAGE_W - 2 * MARGIN, 61, white, stroke=LINE)
    text(c, MARGIN + 13, y + 39, label.upper(), 7.4, MUTED, "Helvetica-Bold")
    rounded_box(c, MARGIN + 13, y + 12, 112, 23, status_fill, stroke=status_fill, radius=7)
    text(c, MARGIN + 23, y + 19, status, 9, status_color, "Helvetica-Bold")
    wrapped(c, MARGIN + 140, y + 39, evidence, width_chars=63, size=9.1, leading=12, color=INK)


def metric_card(c, x, y, width, label, value, note, fill, accent):
    rounded_box(c, x, y, width, 69, fill, stroke=fill)
    text(c, x + 11, y + 49, label.upper(), 7.1, accent, "Helvetica-Bold")
    text(c, x + 11, y + 26, value, 18, NAVY, "Helvetica-Bold")
    text(c, x + 11, y + 10, note, 7.5, MUTED)


def numbered_action(c, x, y, number, title, body, accent=BLUE, width_chars=67):
    c.setFillColor(accent)
    c.circle(x + 11, y + 5, 11, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(x + 11, y + 2, str(number))
    text(c, x + 32, y + 7, title, 9.8, NAVY, "Helvetica-Bold")
    return wrapped(c, x + 32, y - 8, body, width_chars=width_chars, size=8.5, leading=11, color=MUTED)


def risk_row(c, x, y, rank, title, body):
    text(c, x, y, str(rank), 15, RED, "Helvetica-Bold")
    text(c, x + 23, y + 3, title, 9.2, NAVY, "Helvetica-Bold")
    wrapped(c, x + 23, y - 10, body, width_chars=63, size=8.2, leading=10.5, color=MUTED)


def task_card(c, y, task_id, title, owner, why, action, done, approval, accent=BLUE, fill=white):
    height = 166
    width = PAGE_W - 2 * MARGIN
    rounded_box(c, MARGIN, y, width, height, fill, stroke=LINE)
    rounded_box(c, MARGIN + 12, y + height - 38, 39, 23, accent, stroke=accent, radius=7)
    text(c, MARGIN + 21, y + height - 31, task_id, 8.3, white, "Helvetica-Bold")
    text(c, MARGIN + 62, y + height - 29, title, 12, NAVY, "Helvetica-Bold")
    right_text(c, PAGE_W - MARGIN - 12, y + height - 29, owner, 7.5, accent, "Helvetica-Bold")

    text(c, MARGIN + 16, y + height - 58, "WHY", 7.1, MUTED, "Helvetica-Bold")
    wrapped(c, MARGIN + 58, y + height - 58, why, width_chars=83, size=8.4, leading=10.5, color=INK)

    text(c, MARGIN + 16, y + height - 88, "DO", 7.1, MUTED, "Helvetica-Bold")
    wrapped(c, MARGIN + 58, y + height - 88, action, width_chars=83, size=8.4, leading=10.5, color=INK)

    text(c, MARGIN + 16, y + height - 118, "DONE", 7.1, MUTED, "Helvetica-Bold")
    wrapped(c, MARGIN + 58, y + height - 118, done, width_chars=83, size=8.4, leading=10.5, color=INK, font="Helvetica-Bold")

    no_approval_required = approval.startswith("NOT REQUIRED")
    approval_fill = PALE_GREEN if no_approval_required else PALE_RED
    approval_color = GREEN if no_approval_required else RED
    rounded_box(c, MARGIN + 16, y + 12, width - 32, 24, approval_fill, stroke=approval_fill, radius=7)
    text(c, MARGIN + 27, y + 19, f"APPROVAL: {approval}", 7.8, approval_color, "Helvetica-Bold")


def main():
    for source in (ADMIN_SOURCE, FINANCE_SOURCE):
        if not source.exists():
            raise SystemExit(f"Required live report not found: {source}")

    admin = json.loads(ADMIN_SOURCE.read_text(encoding="utf-8"))
    finance = json.loads(FINANCE_SOURCE.read_text(encoding="utf-8"))
    businesses = admin.get("businesses") or {}
    calls = admin.get("calls30Days") or {}
    trials = (admin.get("trials") or {}).get("billing") or {}
    phone_system = (admin.get("phoneSystem") or {}).get("totals") or {}
    allocation = finance.get("businessAllocation") or {}
    inventory = allocation.get("phoneInventory") or {}
    drivers = {item.get("label"): item for item in allocation.get("costDrivers") or []}
    stripe = finance.get("stripe") or {}

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=letter)
    c.setTitle("MyAIPA Boss Brief - Aug. 28, 2026")
    c.setAuthor("MyAIPA")

    # Page 1: the one-page decision summary.
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Executive decision brief", "Where we are today", "MyAIPA operating, commercial, and financial status as of Aug. 28, 2026", 1)

    rounded_box(c, MARGIN, PAGE_H - 157, PAGE_W - 2 * MARGIN, 56, PALE_YELLOW, stroke=HexColor("#F4D59A"))
    text(c, MARGIN + 14, PAGE_H - 125, "OVERALL STATUS", 7.5, YELLOW, "Helvetica-Bold")
    text(c, MARGIN + 14, PAGE_H - 148, "YELLOW - FOCUS", 18, NAVY, "Helvetica-Bold")
    text(c, MARGIN + 192, PAGE_H - 132, "The product is operating.", 10.4, NAVY, "Helvetica-Bold")
    text(c, MARGIN + 192, PAGE_H - 148, "Commercial proof and financial controls are incomplete.", 9.5, INK)

    y = PAGE_H - 232
    status_row(c, y, "Technical service", "WORKING", "13 of 13 recent calls were answered; no missed or failed calls were reported.", PALE_GREEN, GREEN)
    y -= 68
    status_row(c, y, "Business readiness", "NEEDS WORK", "4 of 16 business records are ready. The other 12 are waiting, manual, or blocked.", PALE_YELLOW, YELLOW)
    y -= 68
    status_row(c, y, "Trial pipeline", "ACTIVE", "4 Stripe trials are active and 1 ends within 3 days; 11 subscriptions are paused.", PALE_BLUE, BLUE)
    y -= 68
    status_row(c, y, "Commercial evidence", "NOT PROVEN", "0 booked outcomes and 0 leads are recorded; 10 follow-ups and 124 calls need review.", PALE_RED, RED)
    y -= 68
    status_row(c, y, "Financial control", "INCOMPLETE", f"{money(allocation.get('accountTotalUsd'))} known YTD cost; {money(allocation.get('unallocatedTotalUsd'))} is unallocated or shared.", PALE_YELLOW, YELLOW)

    rounded_box(c, MARGIN, 77, PAGE_W - 2 * MARGIN, 63, NAVY, stroke=NAVY)
    text(c, MARGIN + 14, 121, "BOSS IN ONE SENTENCE", 7.4, HexColor("#9EC5FF"), "Helvetica-Bold")
    wrapped(
        c,
        MARGIN + 14,
        101,
        "Do not scale yet: first prove one paid customer, reconcile phone ownership, and turn the current call and trial activity into measurable outcomes.",
        width_chars=91,
        size=10.3,
        leading=14,
        color=white,
        font="Helvetica-Bold",
    )
    footer(c, 1)
    c.showPage()

    # Page 2: evidence and operational risks.
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Evidence", "What the numbers say", "Verified operational indicators, cost drivers, and known reporting gaps", 2)

    text(c, MARGIN, PAGE_H - 109, "OPERATING PATH", 8.2, NAVY, "Helvetica-Bold")
    path_y = PAGE_H - 165
    path_labels = [
        ("16", "business records"),
        ("4", "ready"),
        ("4", "active trials"),
        ("0", "bookings recorded"),
    ]
    path_gap = 9
    path_w = (PAGE_W - 2 * MARGIN - 3 * path_gap) / 4
    for index, (value, label) in enumerate(path_labels):
        x = MARGIN + index * (path_w + path_gap)
        fill = PALE_RED if index == 3 else PALE_BLUE
        accent = RED if index == 3 else BLUE
        metric_card(c, x, path_y, path_w, label, value, "current reporting", fill, accent)
    text(c, MARGIN, path_y - 15, "These records overlap and include test or legacy data; this is an operating path, not a strict sales cohort.", 7.8, MUTED)

    text(c, MARGIN, PAGE_H - 267, "LAST 30 DAYS", 8.2, NAVY, "Helvetica-Bold")
    small_gap = 8
    small_w = (PAGE_W - 2 * MARGIN - 4 * small_gap) / 5
    recent_cards = [
        ("Calls", str(calls.get("total") or 0), PALE_BLUE, BLUE),
        ("Minutes", f"{float(calls.get('totalMinutes') or 0):.1f}", PALE_BLUE, BLUE),
        ("Follow-ups", str(calls.get("followUps") or 0), PALE_YELLOW, YELLOW),
        ("Bookings", str(calls.get("booked") or 0), PALE_RED, RED),
        ("Unreviewed", str(calls.get("synchronizedRowsVisible") or 0), PALE_RED, RED),
    ]
    for index, (label, value, fill, accent) in enumerate(recent_cards):
        x = MARGIN + index * (small_w + small_gap)
        metric_card(c, x, PAGE_H - 344, small_w, label, value, "reported", fill, accent)

    text(c, MARGIN, PAGE_H - 381, "WHERE THE KNOWN 2026 COST WENT", 8.2, NAVY, "Helvetica-Bold")
    cost_y = PAGE_H - 438
    cost_gap = 10
    cost_w = (PAGE_W - 2 * MARGIN - 2 * cost_gap) / 3
    number_rent = drivers.get("Phone-number rental") or {}
    twilio_use = drivers.get("Twilio calls, texts, media, and other usage") or {}
    vapi = drivers.get("Vapi AI call processing") or {}
    metric_card(c, MARGIN, cost_y, cost_w, "Phone rent", money(number_rent.get("amountUsd")), f"{number_rent.get('percent', 0):.1f}% of known", PALE_YELLOW, YELLOW)
    metric_card(c, MARGIN + cost_w + cost_gap, cost_y, cost_w, "Twilio usage", money(twilio_use.get("amountUsd")), "calls, texts, media", PALE_BLUE, BLUE)
    metric_card(c, MARGIN + 2 * (cost_w + cost_gap), cost_y, cost_w, "Vapi processing", money(vapi.get("amountUsd")), "AI call processing", PALE_GREEN, GREEN)

    rounded_box(c, MARGIN, PAGE_H - 532, PAGE_W - 2 * MARGIN, 70, PALE_YELLOW, stroke=HexColor("#F4D59A"))
    text(c, MARGIN + 13, PAGE_H - 483, "INVENTORY MISMATCH", 7.4, YELLOW, "Helvetica-Bold")
    text(c, MARGIN + 13, PAGE_H - 504, f"{inventory.get('activeNumbers', 0)} active Twilio numbers; only {inventory.get('mappedActiveNumbers', 0)} mapped", 12.5, NAVY, "Helvetica-Bold")
    text(c, MARGIN + 13, PAGE_H - 521, f"Vapi reports {phone_system.get('phoneNumbers', 0)} phone records and {phone_system.get('assistants', 0)} assistants; many may be test or legacy objects.", 8.5, INK)
    right_text(c, PAGE_W - MARGIN - 13, PAGE_H - 486, f"{money(allocation.get('unallocatedTotalUsd'))} unallocated", 10.5, RED, "Helvetica-Bold")

    text(c, MARGIN, PAGE_H - 565, "TOP RISKS", 8.2, NAVY, "Helvetica-Bold")
    risk_row(c, MARGIN, PAGE_H - 597, 1, "Commercial evidence is missing", "Calls and trials exist, but no booked or paid outcome is visible.")
    risk_row(c, MARGIN, PAGE_H - 643, 2, "Cost ownership is unclear", "Six active numbers are unassigned and one number is shared across businesses.")
    risk_row(c, MARGIN, PAGE_H - 689, 3, "Cash settlement is incomplete", "Stripe payouts are disabled; bank, card, and overhead feeds are not connected.")
    risk_row(c, MARGIN, PAGE_H - 735, 4, "The outcome backlog hides the truth", "Until 124 calls are reviewed, conversion decisions are not evidence-backed.")
    footer(c, 2)
    c.showPage()

    # Page 3: immediate operating tasks with definitions of done.
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Detailed task register", "First: establish the truth", "Immediate operating work, completion evidence, and decision rights", 3)

    task_card(
        c, 512, "T01", "Build the 12-number ownership map", "CODEX PREPARES",
        "Phone rent is 86.6% of known cost, but 6 active numbers are unassigned and ****0318 is shared.",
        "Join Twilio inventory, Vapi routing, business mappings, and recent activity. Flag conflicts and inactive candidates.",
        "12 of 12 numbers have one confirmed owner; all 6 gaps and the shared mapping are resolved; cancellation candidates are separate.",
        "REQUIRED FOR ANY LIVE MAPPING CHANGE OR CANCELLATION", YELLOW,
    )
    task_card(
        c, 331, "T02", "Classify the 124 unreviewed calls", "CODEX + OPERATOR",
        "Until outcomes are known, the business cannot distinguish interest, support, spam, lost leads, or bookings.",
        "Assign outcome, confidence, business, customer intent, and next action. Send uncertain or sensitive cases to human review.",
        "124 of 124 calls have an outcome and confidence; uncertain cases have a named reviewer and due date.",
        "NOT REQUIRED FOR READ-ONLY REVIEW", GREEN,
    )
    task_card(
        c, 150, "T03", "Close the 10 follow-up items", "SALES / OPERATOR",
        "Follow-ups are the shortest route from existing activity to proof of customer value and a possible paid pilot.",
        "For each item, confirm owner, contact method, message, deadline, and offer. Draft customer communication before sending.",
        "10 of 10 items are marked contacted, booked, declined, no response with retry date, or closed with reason.",
        "REQUIRED BEFORE CUSTOMER-FACING SENDS", BLUE,
    )
    footer(c, 3)
    c.showPage()

    # Page 4: decisions and finance-control tasks.
    c.setFillColor(white)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Detailed task register", "Next: convert and reconcile", "Time-sensitive trial decisions and complete financial visibility", 4)

    task_card(
        c, 512, "T04", "Decide the trial ending within 3 days", "BOSS DECIDES",
        "A trial can quietly expire without a conversion attempt, customer decision, or recorded learning.",
        "Prepare a one-page evidence packet: usage, outcomes, customer intent, support issues, price, and recommended disposition.",
        "Convert, extend, or stop is recorded with the owner, decision date, reason, price, and next customer contact.",
        "REQUIRED FOR OFFER, EXTENSION, OR CHARGE", RED,
    )
    task_card(
        c, 331, "T05", "Deploy the read-only finance endpoint", "CODEX CAN EXECUTE",
        "Current Stripe reporting shows subscription state but not balance transactions, fees, refunds, or payouts.",
        "Run focused tests, deploy protected GET /api/admin/finance-ledger, rerun the report, and verify no write method exists.",
        "The live report measures Stripe financial activity and summarizes balances, fees, refunds, and payouts without mutation.",
        "REQUIRED FOR LIVE DEPLOYMENT", BLUE,
    )
    task_card(
        c, 150, "T06", "Reconcile settlements and overhead", "BOSS AUTHORIZES",
        "Bank settlement and Render, Make, OpenAI, domain, and email costs are still missing from the complete cash picture.",
        "Connect secure read-only bank and card feeds; add billing APIs or reviewed monthly amounts for infrastructure providers.",
        "Known charges match settled transactions; overhead is categorized; exceptions have an owner; monthly burn is visible.",
        "REQUIRED FOR ACCOUNT CONNECTIONS", YELLOW,
    )
    footer(c, 4)
    c.showPage()

    # Page 5: sequence, scorecard, and the consolidated approval queue.
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    page_header(c, "Management view", "How the work gets controlled", "Sequence, measurable milestones, and the consolidated boss approval queue", 5)

    rounded_box(c, MARGIN, 620, PAGE_W - 2 * MARGIN, 70, NAVY, stroke=NAVY)
    text(c, MARGIN + 15, 670, "ORDER OF OPERATIONS", 7.5, HexColor("#9EC5FF"), "Helvetica-Bold")
    text(c, MARGIN + 15, 643, "1. DATA TRUTH   >   2. MONEY TRUTH   >   3. COMMERCIAL PROOF", 12.2, white, "Helvetica-Bold")
    text(c, MARGIN + 15, 628, "Do not scale a funnel whose outcomes and costs cannot yet be trusted.", 8.4, HexColor("#D8E9FF"))

    text(c, MARGIN, 596, "MILESTONE SCORECARD", 8.2, NAVY, "Helvetica-Bold")
    table_x = MARGIN
    table_y = 447
    table_w = PAGE_W - 2 * MARGIN
    row_h = 35
    rounded_box(c, table_x, table_y, table_w, 130, white, stroke=LINE)
    c.setFillColor(PALE_BLUE)
    c.rect(table_x, table_y + 103, table_w, 27, fill=1, stroke=0)
    columns = [table_x + 12, table_x + 86, table_x + 335]
    text(c, columns[0], table_y + 112, "WHEN", 7.2, BLUE, "Helvetica-Bold")
    text(c, columns[1], table_y + 112, "DELIVERABLE", 7.2, BLUE, "Helvetica-Bold")
    text(c, columns[2], table_y + 112, "PASS CONDITION", 7.2, BLUE, "Helvetica-Bold")
    milestone_rows = [
        ("48 HOURS", "Ownership + outcomes", "12/12 numbers; 124/124 calls"),
        ("48 HOURS", "Urgent trial decision", "Convert, extend, or stop recorded"),
        ("7 DAYS", "Finance visibility", "Stripe activity + settlement gaps clear"),
        ("30 DAYS", "Commercial proof", "1 paid pilot + first visible payout"),
    ]
    for index, (when, deliverable, condition) in enumerate(milestone_rows):
        y = table_y + 84 - index * 25
        text(c, columns[0], y, when, 7.5, MUTED, "Helvetica-Bold")
        text(c, columns[1], y, deliverable, 8.3, INK, "Helvetica-Bold")
        text(c, columns[2], y, condition, 8.1, INK)
        if index < len(milestone_rows) - 1:
            c.setStrokeColor(LINE)
            c.line(table_x + 10, y - 9, table_x + table_w - 10, y - 9)

    text(c, MARGIN, 421, "CONSOLIDATED APPROVAL QUEUE", 8.2, NAVY, "Helvetica-Bold")
    approvals = [
        ("1", "Urgent trial disposition", "Protect the conversion window", "Decide now"),
        ("2", "Deploy finance endpoint", "Add Stripe money visibility", "Approve deploy"),
        ("3", "Review Stripe payouts", "Receive paid-customer funds", "Review only"),
        ("4", "Connect read-only feeds", "Reconcile bank and card cash", "Authorize"),
        ("5", "Phone changes or cancellation", "Control rental cost safely", "Evidence first"),
    ]
    approval_top = 394
    for index, (rank, decision, effect, next_step) in enumerate(approvals):
        y = approval_top - index * 43
        fill = white if index % 2 == 0 else HexColor("#F1F5F9")
        rounded_box(c, MARGIN, y - 31, PAGE_W - 2 * MARGIN, 36, fill, stroke=fill, radius=6)
        text(c, MARGIN + 12, y - 20, rank, 10, RED if index == 0 else BLUE, "Helvetica-Bold")
        text(c, MARGIN + 35, y - 13, decision, 8.4, NAVY, "Helvetica-Bold")
        text(c, MARGIN + 35, y - 25, effect, 7.5, MUTED)
        right_text(c, PAGE_W - MARGIN - 12, y - 19, next_step, 7.8, RED if index == 0 else BLUE, "Helvetica-Bold")

    rounded_box(c, MARGIN, 111, PAGE_W - 2 * MARGIN, 61, PALE_YELLOW, stroke=HexColor("#F4D59A"))
    text(c, MARGIN + 13, 151, "WEEKLY REPORT FORMAT", 7.4, YELLOW, "Helvetica-Bold")
    text(c, MARGIN + 13, 130, "Every task: status | owner | evidence | next action | due date | approval needed", 9.2, NAVY, "Helvetica-Bold")
    text(c, MARGIN + 13, 116, "Any blocked or overdue item moves to the top of the next boss brief.", 8, INK)

    rounded_box(c, MARGIN, 49, PAGE_W - 2 * MARGIN, 47, PALE_RED, stroke=HexColor("#F7C3C0"))
    text(c, MARGIN + 13, 79, "FIRST BOSS DECISION", 7.3, RED, "Helvetica-Bold")
    text(c, MARGIN + 13, 61, "Decide the trial ending soon; then approve the read-only finance deployment.", 9.4, NAVY, "Helvetica-Bold")
    footer(c, 5)

    c.save()
    print(str(OUTPUT))


if __name__ == "__main__":
    main()

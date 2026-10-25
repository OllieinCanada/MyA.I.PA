"""A new one-page report; preserve the earlier October 25 report and print ticket."""
import argparse
import json
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTICS = Path('C:/Users/Olive/.codex/worktrees/provider-hardening-recovery/MyAIPA-Website/diagnostics')
OUTPUT = ROOT / 'output/pdf/My_AI_PA_Boss_Reliability_Update_Oct25_2026.pdf'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--with-explainer', action='store_true')
    args = parser.parse_args()
    output = OUTPUT.with_name('My_AI_PA_Boss_Update_and_Simple_Examples_Oct25_2026.pdf') if args.with_explainer else OUTPUT
    expected_pages = 2 if args.with_explainer else 1
    evidence = DIAGNOSTICS / 'provider-hardening'
    read = lambda name: json.loads((evidence / name).read_text(encoding='utf-8'))
    handoff, restore, intake = read('handoff.json'), read('restore.json'), read('intake.json')
    for name in ('health', 'restore', 'chain', 'intake'):
        assert handoff['gates'][name]['status'] == 'PASS'
    assert handoff['gates']['release']['status'] == 'BLOCKED'
    assert restore['ok'] and restore['tablesVerified'] == 36 and restore['constraintsValidated']
    assert intake['passed'] and intake['realProviderRequests'] == 0
    assert intake['leadsForCompletedCall'] == intake['notificationHandoffs'] == 1
    assert all(handoff['effects'][key] == 0 for key in ('realSmsSent', 'realCallsPlaced', 'billingChanges', 'pushes', 'merges', 'deployments'))
    restart = json.loads((DIAGNOSTICS / 'signup-failure-recovery-audit/postgres-restart.json').read_text())
    chain = json.loads((DIAGNOSTICS / 'signup-failure-recovery-audit/verified-setup-chain.json').read_text())
    assert restart['passed'] and len(restart['cases']) == 28
    assert chain['passed'] and len(chain['cases']) == 5 and chain['externalProvidersMocked']

    navy = colors.HexColor('#122940')
    blue = colors.HexColor('#225b8d')
    gray = colors.HexColor('#4b5662')
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle('TitleBoss', fontName='Helvetica-Bold', fontSize=23, leading=27, textColor=navy))
    styles.add(ParagraphStyle('SubBoss', fontName='Helvetica', fontSize=10, leading=14, textColor=gray))
    styles.add(ParagraphStyle('BodyBoss', fontName='Helvetica', fontSize=10.6, leading=14.3, textColor=navy, spaceAfter=7))
    styles.add(ParagraphStyle('HeadingBoss', fontName='Helvetica-Bold', fontSize=10.5, leading=13.5, textColor=blue, spaceBefore=10, spaceAfter=5))
    styles.add(ParagraphStyle('NumberBoss', fontName='Helvetica-Bold', fontSize=16, leading=21, textColor=navy, alignment=TA_CENTER))
    styles.add(ParagraphStyle('LabelBoss', fontName='Helvetica', fontSize=9, leading=12, textColor=gray, alignment=TA_CENTER))
    p = lambda text, style='BodyBoss': Paragraph(text, styles[style])
    story = [p('MY AI PA | BOSS UPDATE', 'TitleBoss'),
             p('Sunday, October 25, 2026  |  Safety and reliability, in plain English', 'SubBoss'), Spacer(1, 12),
             p('<b>The short version:</b> We checked the working system, proved that a real backup can be restored, '
               'and built safer ways to save caller details without creating duplicates. '
               '<b>The new changes are tested privately, not deployed.</b>')]

    metrics = Table([
        [p('36 tables', 'NumberBoss'), p('28 scenarios', 'NumberBoss'), p('5 signups', 'NumberBoss')],
        [p('Restored and checked', 'LabelBoss'), p('Restart and failure tests', 'LabelBoss'), p('Complete simulated chains', 'LabelBoss')],
    ], colWidths=[176, 176, 176])
    metrics.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#f0f4f7')),
        ('BOX', (0, 0), (-1, -1), 0.6, colors.HexColor('#c9d3dc')),
        ('TOPPADDING', (0, 0), (-1, 0), 9), ('BOTTOMPADDING', (0, -1), (-1, -1), 9),
    ]))
    story += [metrics, p('WHAT WE DID - AND WHY IT HELPS', 'HeadingBoss'),
        p('<b>1. Checked the live system.</b> Confirmed the existing security fixes are running. The worker that '
          'processes text-delivery updates was active, with no waiting or failed jobs in our checks. '
          '<b>Benefit:</b> problems are checked at the source, not just by seeing whether the homepage loads.'),
        p('<b>2. Practised recovering from a disaster.</b> Encrypted a real database backup and restored it twice '
          'into disposable, private test databases. All 36 tables and their database rules passed. '
          '<b>Benefit:</b> we have evidence the backup works, without overwriting customer data.'),
        p('<b>3. Tested repeats and interruptions.</b> Simulated restarts, lost replies and repeated signup messages. '
          'Each test signup created only one number, assistant and subscription, with the intended texts. '
          '<b>Benefit:</b> helps prevent extra charges and duplicate messages when a connection fails.'),
        p('<b>4. Built a better customer notebook.</b> The private pilot keeps the latest confirmed caller details, '
          'rejects conflicting or unconfirmed changes, and creates one final customer record and notification job. '
          'Uncertain sends are held instead of blindly resent. <b>Benefit:</b> fewer wrong addresses, old answers '
          'and duplicate alerts. This pilot is off in production.'),
        p('<b>5. Added clearer cost and health checks.</b> Collected provider funding and resource information. '
          'One hour of server and database samples showed no obvious capacity pressure. '
          '<b>Benefit:</b> better evidence before spending money on upgrades; short spikes are still possible.')]

    story += [p('HOW STRONGLY WAS THIS TESTED?', 'HeadingBoss'),
        p('<b>158 server-test files passed, plus 23 final focused checks.</b> The 28 restart/failure scenarios and '
          '5 signup scenarios used real test databases but fake phone-provider responses. The intake test also '
          'checked corrections, repeated messages and safe cancellation of failed database changes. '
          '<b>This does not prove real phone or text delivery.</b>')]

    remaining = p('<b>BEFORE GOING LIVE:</b> Verify payment methods, renewals and Vapi credits; identify a dedicated '
        'test phone/environment; finish the pilot delivery worker; run a real, limited call/text test; and complete '
        '24-hour observation. Independent monitoring remains deferred. Old incident records and paused trials '
        'were preserved, not marked fixed.')
    box = Table([[remaining]], colWidths=[528])
    box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#fff7e8')),
        ('BOX', (0, 0), (-1, -1), 0.6, colors.HexColor('#d9c39a')),
        ('LEFTPADDING', (0, 0), (-1, -1), 10), ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 9), ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story += [Spacer(1, 3), box, Spacer(1, 8),
        p('<b>Bottom line:</b> We reduced risk and proved more of the safety net. No real calls or texts were sent, '
          'no numbers were bought, and no billing settings changed. No new code was pushed, merged or deployed.')]

    if args.with_explainer:
        story += [PageBreak(), p('WHAT THIS REALLY MEANS', 'TitleBoss'),
            p('A very simple guide, with made-up examples', 'SubBoss'), Spacer(1, 11),
            p('<b>Think of My AI PA as a small office.</b> Twilio handles phone numbers and texts. Vapi supplies '
              'the speaking assistant. Render runs our server and stores business records. Make connects '
              'automated tasks. Our goal is to keep Make out of urgent call answering wherever possible.'),
            p('1. CHECK THE OFFICE, NOT JUST THE SIGN', 'HeadingBoss'),
            p('<b>Example:</b> A shop can have its lights on while the cash register is broken. A working homepage '
              'does not prove that text updates are being processed. <b>What we did:</b> checked the running '
              'security fixes, waiting jobs and the worker\'s latest successful check-ins. '
              '<b>Why it helps:</b> catches hidden trouble. These checks were snapshots, not an all-day guarantee.'),
            p('2. A BACKUP IS A SPARE NOTEBOOK', 'HeadingBoss'),
            p('<b>Example:</b> If the main notebook is lost, a spare is useful only if its pages can be read. '
              '<b>What we did:</b> locked a real backup with encryption, like a box needing a secret key, '
              'then opened and restored it in separate test databases. All 36 groups of records matched. '
              '<b>Why it helps:</b> proves this backup can be recovered without practising on customer data. '
              'We have not yet practised moving the whole live service to a replacement.'),
            p('3. ONE ORDER SHOULD NOT BECOME TWO ORDERS', 'HeadingBoss'),
            p('<b>Example:</b> You buy a number, but the confirmation gets lost. Pressing again should not buy '
              'a second number. <b>How it works:</b> saved reference numbers and progress records let repeat '
              'requests find the same job after a restart. The tests checked one of each signup resource. '
              'For an uncertain text send, the new pilot stops for checking instead of guessing and sending again. '
              '<b>Why it helps:</b> fewer surprise charges and repeated messages.'),
            p('4. KEEP THE CORRECTED ANSWER, NOT THE OLD GUESS', 'HeadingBoss'),
            p('<b>Example:</b> A caller says "10 Oak Street," then confirms "Sorry, 20 Oak Street." '
              '<b>How it works:</b> the pilot saves numbered versions, accepts only details marked confirmed, '
              'and rejects late or conflicting changes. It saves the final customer record and notification job '
              'together; if that database step fails, neither is partly saved. '
              '<b>Why it helps:</b> one final job with 20 Oak Street, not two competing jobs. '
              'Real calls must still prove that the assistant marks confirmation honestly.'),
            p('5. CHECK THE FUEL BEFORE BUYING A BIGGER TRUCK', 'HeadingBoss'),
            p('<b>Example:</b> More engine power cannot fix an empty fuel tank. '
              '<b>What we did:</b> read available usage, balances and computer-capacity figures. '
              'The one-hour samples did not show obvious crowding. '
              '<b>Why it helps:</b> guides spending. Card, renewal, automatic top-up and Vapi credit checks '
              'still need finishing; missing information is not treated as "all good."'),
            p('6. PRACTICE IS NOT THE REAL GAME', 'HeadingBoss'),
            p('<b>Example:</b> A fire drill is useful, but it is not a real fire. We used real test databases '
              'and pretend phone-provider replies to safely test failures and repeats. '
              '<b>Next:</b> finish the pilot\'s delivery worker, use a separate live test phone, check real calls '
              'and texts, and observe stability for 24 hours. The new pilot stays off for customers until ready. '
              '<b>No real calls or texts were sent in these tests.</b>')]

    def footer(canvas, document):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor('#c9d3dc'))
        canvas.line(42, 40, 570, 40)
        canvas.setFillColor(gray)
        canvas.setFont('Helvetica', 7.5)
        canvas.drawString(42, 27, 'Evidence: Oct. 25 audit and isolated drills; live health checked at 3:17 PM Toronto time.')
        canvas.drawRightString(570, 27, f'{document.page} / {expected_pages}')
        canvas.restoreState()

    output.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(str(output), pagesize=letter, leftMargin=42, rightMargin=42, topMargin=34, bottomMargin=51,
        title='My AI PA - Boss Reliability Update - October 25, 2026', author='My AI PA',
        subject='One-page plain-language summary of reliability work, evidence and remaining limits')
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    reader = PdfReader(str(output))
    assert len(reader.pages) == expected_pages, f'Expected {expected_pages} pages, got {len(reader.pages)}'
    text = ' '.join(reader.pages[0].extract_text().split())
    for phrase in ('36 tables', '158', '23', 'BEFORE GOING LIVE', 'not deployed', '24-hour'):
        assert phrase in text
    if args.with_explainer:
        explanation = ' '.join(reader.pages[1].extract_text().split())
        assert all(phrase in explanation for phrase in ('20 Oak Street', 'SPARE NOTEBOOK', 'pretend phone-provider', 'stays off'))
    print(json.dumps({'path': str(output), 'pages': len(reader.pages), 'words': sum(len(page.extract_text().split()) for page in reader.pages), 'bytes': output.stat().st_size}))


if __name__ == '__main__':
    main()

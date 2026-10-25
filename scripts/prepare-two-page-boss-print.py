"""Freeze the authorized two-page document and print assets; never submit a job."""
import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
PDF = ROOT / 'output/pdf/My_AI_PA_Boss_Update_and_Simple_Examples_Oct25_2026.pdf'
JOB = Path(os.environ['LOCALAPPDATA']) / 'MyAIPA/PrintJobs/2026-10-25-reliability-explainer-now'
POPPLER = Path('C:/Users/Olive/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe')


def sha256(file):
    return hashlib.sha256(file.read_bytes()).hexdigest().upper()


def main():
    receipt = JOB / 'submission-receipt.json'
    if receipt.exists():
        raise RuntimeError('A print receipt already exists. Do not prepare or submit another job.')
    assert len(PdfReader(str(PDF)).pages) == 2
    JOB.parent.mkdir(parents=True, exist_ok=True)
    JOB.mkdir(exist_ok=False)
    frozen_pdf = JOB / 'report.pdf'
    shutil.copyfile(PDF, frozen_pdf)
    helper = JOB / 'print-once.ps1'
    shutil.copyfile(ROOT / 'scripts/print-two-page-report-once.ps1', helper)
    subprocess.run([str(POPPLER), '-r', '300', '-png', str(frozen_pdf), str(JOB / 'page')], check=True)
    images = []
    for number in (1, 2):
        file = JOB / f'page-{number}.png'
        with Image.open(file) as image:
            width, height = image.size
        assert (width, height) == (2550, 3300)
        images.append({'Path': str(file), 'Sha256': sha256(file), 'Width': width, 'Height': height})
    now = datetime.now(timezone.utc)
    ticket = {'PrinterName': 'Brother DCP-L2540DW series Printer', 'Copies': 1, 'PageCount': 2,
        'DocumentName': 'My AI PA - Boss summary and simple examples - Oct 25 2026',
        'PdfPath': str(frozen_pdf), 'PdfSha256': sha256(frozen_pdf), 'Images': images,
        'ReceiptPath': str(receipt), 'AuthorizedAt': now.isoformat(), 'Deadline': (now + timedelta(minutes=30)).isoformat(),
        'HelperSha256': sha256(helper)}
    ticket_path = JOB / 'ticket.json'
    with ticket_path.open('x', encoding='utf-8') as stream:
        json.dump(ticket, stream, indent=2)
    print(json.dumps({'preparedNotPrinted': True, 'ticket': str(ticket_path), 'helperSha256': ticket['HelperSha256'], 'pages': 2, 'copies': 1}))


if __name__ == '__main__':
    main()

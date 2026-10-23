// Offline layout check using the footer's actual source styles and trial copy.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '../src/Signup.js'), 'utf8');
  const selectors = ['.signup-mobile-action-bar', '.signup-mobile-action-bar button', '.signup-mobile-back', '.signup-mobile-primary', '.signup-mobile-primary:disabled', '.signup-mobile-trial-note', '.signup-mobile-disabled-reason'];
  const styles = selectors.map((selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = source.match(new RegExp(escaped + ' \\{[^}]+\\}'));
    assert.ok(match, `Missing footer style: ${selector}`);
    return match[0];
  }).join('\n');
  const copy = source.match(/<p className="signup-mobile-trial-note">([^<]+)<\/p>/)?.[1];
  assert.ok(copy, 'Missing trial note');
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const output = path.join(__dirname, '../diagnostics/signup-footer');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [320, 360, 390, 393, 412, 430]) {
      const page = await browser.newPage({ viewport: { width, height: 240 } });
      await page.route('**/*', (route) => route.abort());
      await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#f5f8ff;font-family:Arial,sans-serif}${styles}</style><div class="signup-mobile-action-bar"><button class="signup-mobile-back">Back</button><button class="signup-mobile-primary" disabled>Saving… <span>→</span></button><p class="signup-mobile-trial-note">${copy}</p></div>`);
      const layout = await page.locator('.signup-mobile-trial-note').evaluate((note) => {
        const rect = note.getBoundingClientRect();
        const parent = note.parentElement.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(note);
        return { alignment: getComputedStyle(note).textAlign, lines: range.getClientRects().length, centerOffset: Math.abs((rect.left + rect.right - parent.left - parent.right) / 2), overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.equal(layout.alignment, 'center');
      assert.equal(layout.lines, 1, `Trial note wraps at ${width}px`);
      assert.ok(layout.centerOffset < 1, 'Note is not centered across both buttons');
      assert.equal(layout.overflow, false);
      for (const message of ['Choose one trade to continue.', 'Choose at least one property type to continue.',
        'Choose at least one service area to continue.', 'Complete the required business details to continue.',
        'Choose service calls and complete any required prices.', 'Complete the verification above to start your trial.']) {
        await page.evaluate(text => {
          const note = document.querySelector('.signup-mobile-trial-note, .signup-mobile-disabled-reason');
          note.className = 'signup-mobile-disabled-reason'; note.textContent = text;
        }, message);
        const hint = await page.locator('.signup-mobile-disabled-reason').evaluate(note => {
          const rect = note.getBoundingClientRect(), parent = note.parentElement.getBoundingClientRect();
          return { alignment: getComputedStyle(note).textAlign,
            centerOffset: Math.abs((rect.left + rect.right - parent.left - parent.right) / 2),
            overflow: document.documentElement.scrollWidth > innerWidth };
        });
        assert.equal(hint.alignment, 'center');
        assert.ok(hint.centerOffset < 1, `${message} is not centered at ${width}px`);
        assert.equal(hint.overflow, false);
      }
      await page.screenshot({ path: path.join(output, `${width}.png`) });
      console.log(`PASS ${width}px: centered, single line, no horizontal overflow.`);
      await page.close();
    }
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });

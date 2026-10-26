const fs = require('node:fs');
const path = require('node:path');
const copy = require('../src/features/onboarding/onboardingCopy');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function canonicalNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^1\d{10}$/.test(digits) ? `+${digits}` : '';
}

function displayNumber(value) {
  const phone = canonicalNumber(value);
  return phone ? `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}` : '';
}

// The signed capability remains in the frontend fragment, never browser storage
// or a third-party destination. A stored URL cannot become an open redirect.
function wizardLink(setupUrl, frontendAppUrl, { step, edit = false } = {}) {
  try {
    const base = new URL(frontendAppUrl);
    const target = new URL(setupUrl, base);
    if (!setupUrl || target.origin !== base.origin || !['https:', 'http:'].includes(target.protocol)) return '';
    if (target.username || target.password || target.search) return '';
    const [route, query = ''] = target.hash.split('?');
    if (!/^#\/f\/[^/?#]+$/.test(route) && route !== '#/forwarding-setup') return '';
    const params = new URLSearchParams(query);
    if (route === '#/forwarding-setup' && !params.get('token')) return '';
    params.delete('step');
    params.delete('edit');
    if (step) params.set('step', String(step));
    if (edit) params.set('edit', '1');
    target.hash = `${route}${params.size ? `?${params}` : ''}`;
    return target.href;
  } catch (_) { return ''; }
}

function icon(name, className = '') {
  const paths = {
    phone: '<path d="M7 3 4 5c-1 1 0 5 4 9s8 5 9 4l2-3-4-3-2 2c-2-1-4-3-5-5l2-2-3-4Z" fill="currentColor"/>',
    copy: '<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M15 7V3H3v14h5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7" r=".7" fill="currentColor"/>',
    edit: '<path d="m14 4 6 6M4 20l2-7L17 2l5 5-11 11-7 2Z"/>',
  };
  return `<svg class="onboarding-icon ${escapeHtml(className)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
}

function brand(frontendAppUrl) {
  const wave = [21, 26, 31, 36, 41, 46, 51].map((x, index) => {
    const height = [15, 22, 28, 32, 28, 22, 15][index];
    return `<rect x="${x}" y="${36 - height / 2}" width="3.6" height="${height}" rx="1.8" fill="#ff7a00"/>`;
  }).join('');
  return `<header class="onboarding-header"><a class="onboarding-brand" href="${escapeHtml(frontendAppUrl)}/#/" aria-label="My AI PA home"><svg class="onboarding-brand-mark" viewBox="0 0 72 72" fill="none" aria-hidden="true"><path d="M14 40v-6C14 21.8 23.8 12 36 12s22 9.8 22 22v6" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M14 37h7v18h-7a5 5 0 0 1-5-5v-8a5 5 0 0 1 5-5Zm44 0h-7v18h7a5 5 0 0 0 5-5v-8a5 5 0 0 0-5-5Z" fill="currentColor"/><path d="M52 54c0 6.2-5.7 10-13.2 10M36 64h-5.5" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>${wave}</svg><span>My <strong>AI PA</strong></span></a></header>`;
}

function support(top = false) {
  return top
    ? `<aside class="onboarding-support is-top"><strong>${escapeHtml(copy.supportQuestion)}</strong><a class="onboarding-secondary" href="tel:${escapeHtml(copy.supportPhone)}">${icon('phone')}${escapeHtml(copy.supportLabel)}</a></aside>`
    : `<footer class="onboarding-help-footer"><h2>${escapeHtml(copy.supportQuestion)}</h2><a class="onboarding-secondary" href="tel:${escapeHtml(copy.supportPhone)}">${icon('phone')}${escapeHtml(copy.supportLabel)}</a></footer>`;
}

function renderOnboardingReadyPage({ assignedPhone, forwardingSetupUrl = '', forwardingStatus = '', frontendAppUrl = 'https://www.myaipa.ca' }) {
  const phone = canonicalNumber(assignedPhone);
  if (!phone) throw new Error('A verified assigned number is required for the ready page.');
  const forwardUrl = wizardLink(forwardingSetupUrl, frontendAppUrl, { step: 2 });
  const editUrl = wizardLink(forwardingSetupUrl, frontendAppUrl, { edit: true });
  const css = fs.readFileSync(path.join(__dirname, '../src/features/onboarding/onboardingWizard.css'), 'utf8');
  const action = (url, className, text, symbol = '') => url
    ? `<a class="${className}" href="${escapeHtml(url)}">${symbol}${escapeHtml(text)}</a>`
    : `<button class="${className}" type="button" disabled>${symbol}${escapeHtml(text)}</button>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><meta name="referrer" content="no-referrer"/><meta name="robots" content="noindex,nofollow"/><title>${escapeHtml(copy.readyTitle)} | My AI PA</title><style>body{margin:0} ${css}</style></head><body>
  <main class="onboarding-page"><div class="onboarding-shell">
    ${brand(frontendAppUrl.replace(/\/$/, ''))}${support(true)}
    <nav class="onboarding-progress" aria-label="Receptionist setup"><ol>${copy.steps.map((label, index) => `<li data-step="${index + 1}"><button type="button"${index === 0 ? ' aria-current="step"' : ''} data-wizard-url="${escapeHtml(wizardLink(forwardingSetupUrl, frontendAppUrl, { step: index + 1 }))}"><span class="onboarding-step-number">${index + 1}</span><span>${escapeHtml(label)}</span></button></li>`).join('')}</ol></nav>
    <section class="onboarding-panel onboarding-stage-one" aria-labelledby="verification-title">
      <h1 class="onboarding-title" id="verification-title">Your <span class="onboarding-title-brand">My AI PA</span> number is ready</h1>
      <section class="onboarding-number" aria-label="Assigned My AI PA number">
        <a class="onboarding-number-value" href="tel:${escapeHtml(phone)}">${icon('phone')}<span>${escapeHtml(displayNumber(phone))}</span></a>
        <p class="onboarding-number-label">${escapeHtml(copy.numberLabel)}</p>
        <button class="onboarding-secondary onboarding-copy-number" id="copy-number" type="button" data-phone="${escapeHtml(phone)}">${icon('copy')}<span>${escapeHtml(copy.copyNumber)}</span></button>
      </section>
      <section class="onboarding-test" aria-labelledby="receptionist-test-title">
        <h2 id="receptionist-test-title">${escapeHtml(copy.testTitle)}</h2>
        <p id="verification-description">${escapeHtml(copy.practice)}</p>
        <div class="onboarding-info"><span class="onboarding-info-icon" tabindex="0" title="${escapeHtml(copy.testScope)}" aria-describedby="test-mode-scope">i</span><p>${escapeHtml(forwardingStatus === 'active' ? copy.editInfo : copy.testInfo)}</p><span id="test-mode-scope" class="onboarding-visually-hidden">${escapeHtml(copy.testScope)}</span></div>
        <a class="onboarding-primary" href="tel:${escapeHtml(phone)}">${icon('phone')}${escapeHtml(copy.callReceptionist)}</a>${action(editUrl, 'onboarding-secondary', copy.editDetails, icon('edit'))}
      </section>
      <p class="onboarding-ready-next">${escapeHtml(copy.readyForForwarding)}</p>
      ${action(forwardUrl, 'onboarding-primary onboarding-forward-cta', copy.forwardingAction)}
      ${!forwardUrl ? '<p role="status">Your secure setup link is unavailable. Please call support using the button below.</p>' : ''}
    </section>
    ${support(false)}
  </div></main>
  <script>(()=>{document.querySelectorAll('[data-wizard-url]').forEach(tab=>tab.addEventListener('click',()=>{if(tab.dataset.wizardUrl)window.location.assign(tab.dataset.wizardUrl);}));const button=document.getElementById('copy-number');button.addEventListener('click',async()=>{const value=button.dataset.phone;let copied=false;try{await navigator.clipboard.writeText(value);copied=true;}catch(_){const input=document.createElement('textarea');input.value=value;input.setAttribute('aria-label','Number to copy');input.style.position='fixed';input.style.left='0';input.style.top='0';document.body.appendChild(input);input.select();try{copied=document.execCommand('copy');}catch(_){}if(copied)input.remove();}if(copied){button.querySelector('span').textContent='Copied';setTimeout(()=>{button.querySelector('span').textContent='Copy number';},1600);}});})();</script>
  </body></html>`;
}

module.exports = { canonicalNumber, displayNumber, escapeHtml, renderOnboardingReadyPage, wizardLink };

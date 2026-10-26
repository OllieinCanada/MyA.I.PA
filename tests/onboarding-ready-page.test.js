const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const copy = require('../src/features/onboarding/onboardingCopy');
const { canonicalNumber, displayNumber, renderOnboardingReadyPage, wizardLink } = require('../server/onboardingReadyPage');

const base = 'https://www.myaipa.test';
const setupUrl = `${base}/#/f/synthetic-signed-capability`;
const render = options => renderOnboardingReadyPage({ assignedPhone: '+12895550199', forwardingSetupUrl: setupUrl, frontendAppUrl: base, ...options });

test('verified number then uppercase label then practice, exact dialog and supplied edits', () => {
  const dom = new JSDOM(render());
  const doc = dom.window.document;
  assert.equal(doc.querySelector('#verification-title').textContent, copy.readyTitle);
  const number = doc.querySelector('.onboarding-number');
  assert.equal(number.firstElementChild.textContent, '+1 (289) 555-0199');
  assert.equal(number.children[1].textContent, 'THIS IS YOUR NEW RECEPTIONIST PHONE NUMBER');
  assert.equal(number.nextElementSibling.className, 'onboarding-test');
  assert.equal(doc.querySelector('#verification-description').textContent, copy.practice);
  assert.match(doc.querySelector('.onboarding-info p').textContent, /Changed can be made/);
  assert.doesNotMatch(doc.body.textContent, /Practice is optional|After your call, look for both texts/);
  const call = [...doc.querySelectorAll('a')].find(link => link.textContent.includes(copy.callReceptionist));
  assert.equal(call.getAttribute('href'), 'tel:+12895550199');
  assert.equal(doc.querySelectorAll('a[href="tel:+19057885488"]').length, 2);
  const actions = [...doc.querySelectorAll('.onboarding-stage-one .onboarding-primary,.onboarding-stage-one .onboarding-secondary')];
  assert.equal(actions[2].textContent, copy.editDetails);
  assert.equal(actions.at(-1).textContent, copy.forwardingAction);
  assert.match(actions.at(-1).href, /\?step=2$/);
  assert.equal(doc.querySelectorAll('input[type=checkbox],form').length, 0);
  assert.equal(doc.querySelectorAll('.onboarding-progress [aria-current=step]').length, 1);
  dom.window.close();
});

test('edit returns through the same signed wizard, not signup submission', () => {
  const doc = new JSDOM(render()).window.document;
  const edit = [...doc.querySelectorAll('a')].find(link => link.textContent === copy.editDetails);
  assert.equal(edit.href, `${setupUrl}?edit=1`);
  assert.doesNotMatch(edit.href, /signup-complete|new-signup/);
});

test('an already-active forwarding setup does not claim it is disconnected test mode', () => {
  const doc = new JSDOM(render({ forwardingStatus: 'active' })).window.document;
  assert.equal(doc.querySelector('.onboarding-info p').textContent, copy.editInfo);
  assert.doesNotMatch(doc.querySelector('.onboarding-info p').textContent, /nothing is connected/);
});

test('ready renderer refuses missing numbers and uses a dynamic assigned number', () => {
  assert.throws(() => render({ assignedPhone: '' }), /verified assigned number/);
  assert.throws(() => render({ assignedPhone: '+442079460000' }), /verified assigned number/);
  assert.equal(canonicalNumber('+1 (905) 555-0198'), '+19055550198');
  assert.equal(displayNumber('+19055550198'), '+1 (905) 555-0198');
  assert.doesNotMatch(render(), /289\) 512-9460/);
});

test('capability links are same-frontend fragment routes only and escaped', () => {
  for (const unsafe of ['javascript:alert(1)', 'https://other.test/#/f/token', `${base}/#/signup`, `${base}/?token=secret#/f/token`, `${base}/#/forwarding-setup`]) {
    assert.equal(wizardLink(unsafe, base, { step: 2 }), '');
  }
  assert.equal(wizardLink(`${base}/#/forwarding-setup?token=synthetic&step=3`, base, { edit: true }), `${base}/#/forwarding-setup?token=synthetic&edit=1`);
  const html = render({ forwardingSetupUrl: `${base}/#/f/%22%3E%3Cscript%3E` });
  assert.doesNotMatch(html, /<script>"|onerror=/);
  const doc = new JSDOM(render({ forwardingSetupUrl: 'javascript:alert(1)' })).window.document;
  assert.equal(doc.querySelectorAll('a[href^="javascript:"]').length, 0);
  assert.equal(doc.querySelector('.onboarding-forward-cta').disabled, true);
  assert.match(doc.querySelector('[role=status]').textContent, /call support/i);
});

test('no automatic API call, test, provisioning or token storage in ready-page script', async () => {
  let fetches = 0;
  const dom = new JSDOM(render(), {
    url: 'https://api.myaipa.test/api/integrations/verify-signup-contact', runScripts: 'dangerously',
    beforeParse(window) {
      window.fetch = () => { fetches += 1; throw Error('No API writes expected'); };
      window.navigator.clipboard = { writeText: async value => assert.equal(value, '+12895550199') };
    },
  });
  for (const name of ['focus', 'pageshow', 'visibilitychange']) dom.window.dispatchEvent(new dom.window.Event(name));
  dom.window.document.querySelector('#copy-number').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(dom.window.document.querySelector('#copy-number').textContent, 'Copied');
  assert.equal(fetches, 0);
  assert.equal(dom.window.localStorage.length, 0);
  assert.equal(dom.window.sessionStorage.length, 0);
  dom.window.close();
});

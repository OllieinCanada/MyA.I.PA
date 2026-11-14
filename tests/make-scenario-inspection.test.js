const assert = require("node:assert/strict");
const test = require("node:test");

const {
  safeObject,
  safeString,
  safeUrl,
} = require("../scripts/inspect-make-scenario");

test("Make webhook URLs never expose their secret path", () => {
  const secret = "super-secret-webhook-token";
  const output = safeUrl(`https://hook.us2.make.com/${secret}?debug=true`);

  assert.match(output, /^https:\/\/hook\.us2\.make\.com\/\[redacted-webhook-path\]#[a-f0-9]{12}$/);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /debug=true/);
});

test("embedded webhook URLs are redacted inside TwiML or mapped text", () => {
  const secret = "another-private-hook-token";
  const output = safeString(`<Gather action="https://hook.us2.make.com/${secret}">Say something.</Gather>`);

  assert.match(output, /\[redacted-webhook-path\]/);
  assert.doesNotMatch(output, new RegExp(secret));
});

test("known public API endpoint paths remain useful while queries are removed", () => {
  assert.equal(
    safeUrl("https://api.myaipa.ca/api/integrations/twilio/purchase-number?key=private"),
    "https://api.myaipa.ca/api/integrations/twilio/purchase-number"
  );
});

test("secret-labelled Make fields are redacted recursively", () => {
  assert.deepEqual(
    safeObject({ headers: [{ name: "Authorization", value: "Bearer private-value" }] }),
    { headers: [{ name: "[redacted]", value: "[redacted]" }] }
  );
});

test('all header values are private regardless of their name or nesting', () => {
  for (const name of ['x-myaipa-integration-key', 'x-custom-auth', 'Cookie', 'Accept']) {
    const secret = 'PRIVATE_HEADER_CANARY';
    const output = safeObject({ mapper: { headers: [{ name, value: secret }, { key: name, value: secret }] } });
    assert.doesNotMatch(JSON.stringify(output), /PRIVATE_HEADER_CANARY/);
    assert.equal(output.mapper.headers[0].value, '[redacted]');
    assert.equal(output.mapper.headers[1].value, '[redacted]');
  }
});

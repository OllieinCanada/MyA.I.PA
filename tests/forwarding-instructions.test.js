const test = require("node:test");
const assert = require("node:assert/strict");
const { buildForwardingInstructions } = require("../server/forwardingInstructions");

test("forwarding guide uses the assigned number for each carrier path", () => {
  const guides = buildForwardingInstructions("+1 (289) 555-0123");
  assert.deepEqual(guides.map((item) => item.carrier), ["Rogers mobile", "Rogers Home Phone", "Bell business landline"]);
  assert.match(guides[0].steps.join(" "), /Press Call or Send/);
  assert.match(guides[1].steps.join(" "), /Dial \*92/);
  assert.match(guides.at(-1).steps.join(" "), /two beeps/);
  assert.equal(JSON.stringify(guides).includes("+1787"), false);
});

test("forwarding guide is hidden until a valid assigned number exists", () => {
  assert.deepEqual(buildForwardingInstructions("pending"), []);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildForwardingInstructions } = require("../server/forwardingInstructions");

test("forwarding guide uses the assigned number for each carrier path", () => {
  const guides = buildForwardingInstructions("+1 (289) 555-0123");
  assert.deepEqual(guides.map((item) => item.carrier), [
    "Rogers or Fido mobile", "Freedom mobile", "Bell mobile", "TELUS, Koodo, or another mobile carrier", "Rogers home phone", "Landline or business phone system",
  ]);
  assert.match(guides[0].steps.join(" "), /\*61\*2895550123#/);
  assert.match(guides[2].steps.join(" "), /unanswered\/no reply/);
  assert.match(guides.at(-1).steps.join(" "), /15–20 seconds/);
  assert.equal(JSON.stringify(guides).includes("+1787"), false);
});

test("forwarding guide is hidden until a valid assigned number exists", () => {
  assert.deepEqual(buildForwardingInstructions("pending"), []);
});

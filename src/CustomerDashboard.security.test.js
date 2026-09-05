import fs from "fs";
import path from "path";

test("the customer dashboard uses one-time-code sessions and provider-neutral wording", () => {
  const source = fs.readFileSync(path.join(__dirname, "CustomerDashboard.js"), "utf8");

  expect(source).toMatch(/request-code/);
  expect(source).toMatch(/verify-code/);
  expect(source).toMatch(/credentials:\s*"include"/);
  expect(source).not.toMatch(/[>"']\s*Vapi\s*[<"']/i);
  expect(source).not.toMatch(/[>"']\s*Twilio\s*[<"']/i);
});

test("support report privacy remains opt-in for transcripts and caller details", () => {
  const source = fs.readFileSync(path.join(__dirname, "CustomerDashboard.js"), "utf8");

  expect(source).toMatch(/includeSensitiveCallData/);
  expect(source).toMatch(/Include transcript and caller details in the support report/);
  expect(source).toMatch(/These private details are attached only if you send the report/);
});

test("the owner dashboard keeps the first view short and action focused", () => {
  const source = fs.readFileSync(path.join(__dirname, "CustomerDashboard.js"), "utf8");

  expect(source).toMatch(/DO THIS NEXT/);
  expect(source).toMatch(/Ready for calls/);
  expect(source).toMatch(/Calls answered/);
  expect(source).toMatch(/Call back/);
  expect(source).toMatch(/Recent calls/);
  expect(source).toMatch(/<details id="more-settings"/);
  expect(source).toMatch(/More settings/);
  expect(source).toMatch(/Something not working\?/);
  expect(source).not.toMatch(/<aside className="customer-sidebar"/);
});

test("Stripe Checkout stays hidden until the card-free trial is complete", () => {
  const source = fs.readFileSync(path.join(__dirname, "CustomerDashboard.js"), "utf8");

  expect(source).toMatch(/billing\.checkoutAvailable/);
  expect(source).toMatch(/Checkout opens after your trial/);
  expect(source).toMatch(/No card is required during your 14-day free trial/);
});

test("customers are told agent tests run automatically and the button is recovery-only", () => {
  const source = fs.readFileSync(path.join(__dirname, "CustomerDashboard.js"), "utf8");

  expect(source).toMatch(/Every new agent runs this automatically before delivery/);
  expect(source).toMatch(/Retry the automatic test/);
  expect(source).toMatch(/Use the retry below only if support asks/);
  expect(source).not.toMatch(/Run your 2-text safety test/);
});

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

  expect(source).toMatch(/YOUR NEXT STEP/);
  expect(source).toMatch(/My AI PA is working/);
  expect(source).toMatch(/Calls handled/);
  expect(source).toMatch(/People who called/);
  expect(source).toMatch(/Call back/);
  expect(source).toMatch(/calls\.length \? followUpCalls\.length/);
  expect(source).toMatch(/<details id="more-settings"/);
  expect(source).toMatch(/Need to change something\?/);
  expect(source).toMatch(/Most days, you can ignore this/);
  expect(source).toMatch(/We’ll figure out the technical part/);
  expect(source).not.toMatch(/customer-simple-stats/);
  expect(source).not.toMatch(/customer-simple-trial/);
  expect(source).not.toMatch(/<aside className="customer-sidebar"/);
});

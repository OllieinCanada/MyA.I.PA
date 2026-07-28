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

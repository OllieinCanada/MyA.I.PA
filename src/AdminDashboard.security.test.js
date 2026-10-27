import fs from "fs";
import path from "path";

test("call details distinguish conversation completion, handoff, SMS acceptance and carrier delivery", () => {
  const source = fs.readFileSync(path.join(__dirname, "AdminDashboard.js"), "utf8");
  for (const label of ["Request handoff", "Owner text", "Customer text", "Unique tool invocations"]) expect(source).toContain(label);
  expect(source).toMatch(/notificationEvidence\?\.countIsExact/);
  expect(source).toContain("notificationEvidence?.customer?.label");
});

test("the admin browser retains only the secure cookie, not the master password", () => {
  const source = fs.readFileSync(path.join(__dirname, "AdminDashboard.js"), "utf8");

  expect(source).not.toMatch(/sessionStorage/);
  expect(source).not.toMatch(/X-Admin-Password/i);
  expect(source).toMatch(/credentials:\s*"include"/);
  expect(source).toMatch(/\/api\/admin\/login/);
});

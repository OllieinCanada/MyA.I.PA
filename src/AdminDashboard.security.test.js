import fs from "fs";
import path from "path";

test("the admin browser retains only the secure cookie, not the master password", () => {
  const source = fs.readFileSync(path.join(__dirname, "AdminDashboard.js"), "utf8");

  expect(source).not.toMatch(/sessionStorage/);
  expect(source).not.toMatch(/X-Admin-Password/i);
  expect(source).toMatch(/credentials:\s*"include"/);
  expect(source).toMatch(/\/api\/admin\/login/);
});

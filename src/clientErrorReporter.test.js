import {
  buildClientErrorReport,
  getSafeClientRoute,
  redactClientErrorMessage,
  reportClientError,
  resetClientErrorReporterForTests,
} from "./clientErrorReporter";

beforeEach(() => resetClientErrorReporterForTests());

test("client crash report removes private details, stack-free URLs, and hash queries", () => {
  const report = buildClientErrorReport({
    type: "uncaught error",
    message: "Failure for private@example.com +1 (905) 555-0123 token=very-secret at https://example.com/path?auth=hidden",
    component: "Signup<Form>",
    locationValue: { pathname: "/", hash: "#/signup?email=private@example.com" },
    release: "abc123",
  });
  expect(report.route).toBe("/signup");
  expect(JSON.stringify(report)).not.toMatch(/private@example\.com|905|very-secret|auth=hidden/);
  expect(report.message).toMatch(/\[email hidden\]|\[phone hidden\]|\[hidden\]/);
  expect(getSafeClientRoute({ pathname: "/dashboard", hash: "" })).toBe("/dashboard");
});

test("client crash reporter sends once and deduplicates an identical browser error", async () => {
  const fetchImpl = jest.fn(async () => ({ ok: true }));
  const input = {
    type: "uncaught_error",
    message: redactClientErrorMessage("Render failed"),
    locationValue: { pathname: "/signup", hash: "" },
  };
  const first = await reportClientError(input, { fetchImpl, force: true });
  const duplicate = await reportClientError(input, { fetchImpl, force: true });
  expect(first.sent).toBe(true);
  expect(duplicate.reason).toBe("duplicate");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("stack");
});

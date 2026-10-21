import {
  buildClientErrorReport,
  getSafeClientRoute,
  getSafeFailedAsset,
  getSafeMediaFailureDetails,
  redactClientErrorMessage,
  reportClientError,
  resetClientErrorReporterForTests,
} from "./clientErrorReporter";

beforeEach(() => resetClientErrorReporterForTests());

test("public sample audio diagnostics retain filename but never private paths or queries", () => {
  const locationValue = { href: "https://www.myaipa.ca/" };
  expect(getSafeFailedAsset({ currentSrc: "/tims-electrical-2.wav?token=private" }, locationValue)).toBe("/tims-electrical-2.wav");
  expect(getSafeFailedAsset({ src: "/audio/tims-electrical/repair-request.wav" }, locationValue)).toBe("/audio/tims-electrical/repair-request.wav");
  for (const src of ["/audio/customer-recording.wav", "https://other.example/tims-electrical-2.wav"]) {
    expect(getSafeFailedAsset({ src }, locationValue)).toBe("");
  }
});

test("media failures include only validated browser codes and states", () => {
  for (const [code, label] of [[1, "aborted"], [2, "network"], [3, "decode"], [4, "unsupported_source"]]) {
    const details = getSafeMediaFailureDetails({ tagName: "AUDIO", error: { code, message: "private token" }, readyState: 0, networkState: 3 });
    expect(details).toContain(`media=${label}`);
    expect(details).toContain(`code=${code}`);
    expect(details).not.toContain("private");
  }
  expect(getSafeMediaFailureDetails({ tagName: "AUDIO", error: { code: "2" }, readyState: -1, networkState: 99 })).toBe("");
  expect(getSafeMediaFailureDetails({ tagName: "IMG", error: { code: 2 } })).toBe("");
});

test("failed asset diagnostics identify public build files without exposing tokens", () => {
  const locationValue = { href: "https://www.myaipa.ca/" };
  expect(getSafeFailedAsset({ href: "/static/css/main.123.css?token=secret" }, locationValue))
    .toBe("/static/css/main.123.css");
  expect(getSafeFailedAsset({ src: "https://other.example/static/js/main.js" }, locationValue)).toBe("");
  expect(getSafeFailedAsset({ href: "/forwarding-setup?token=secret" }, locationValue)).toBe("");
});

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

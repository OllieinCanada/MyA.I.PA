import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Signup, { SignupSuccessPage } from "./Signup";

jest.mock("@vapi-ai/web", () => jest.fn().mockImplementation(() => ({
  on: jest.fn(), off: jest.fn(), start: jest.fn(), stop: jest.fn(),
})));

const SESSION_KEY = "myaipa_signup_result_v2";
const pending = () => ({
  businessName: "Synthetic Pilot Electric",
  reviewRequired: true,
  signupStatus: {
    id: "attempt_synthetic", token: "private-status-test-token",
    state: "final_checks", terminal: false,
    pollUrl: "/api/signup/status/attempt_synthetic",
  },
  phoneProvisioning: { status: "pending", e164: "" },
});
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => JSON.stringify(body),
});

describe("resumable signup status and pre-activation support", () => {
  let container;
  let root;
  let originalFetch;

  beforeEach(() => {
    jest.useFakeTimers();
    window.sessionStorage.clear();
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() });
    window.scrollTo = jest.fn();
    originalFetch = global.fetch;
    global.fetch = jest.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.useRealTimers();
    global.fetch = originalFetch;
    window.sessionStorage.clear();
  });

  const render = (result = pending()) => act(() => root.render(<SignupSuccessPage result={result} onStartAnother={jest.fn()} />));
  const tick = async (ms = 15000) => act(async () => { jest.advanceTimersByTime(ms); });
  const click = async (label) => {
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  };

  test("refresh restores the original signup instead of opening another form", () => {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(pending()));
    act(() => root.render(<Signup />));
    expect(container.textContent).toMatch(/Final safety checks are underway/);
    expect(container.textContent).not.toMatch(/Choose your trade/);
    expect(container.querySelector("form")).toBeNull();
  });

  test("automatic polling updates readiness and stops at terminal completion", async () => {
    global.fetch.mockResolvedValue(response({ signup: { state: "ready", assignedPhone: "+12895550123", terminal: true, message: "Ready for private testing." } }));
    render();
    await tick();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ headers: { "x-signup-status-token": "private-status-test-token" }, cache: "no-store" });
    expect(global.fetch.mock.calls[0][0]).not.toContain("private-status-test-token");
    await tick(5000);
    expect(container.querySelector('a[href="tel:+12895550123"]')).not.toBeNull();
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)).signupStatus.state).toBe("ready");
    await tick(60000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("an old assigned number is hidden until the saved signup actually passes", async () => {
    global.fetch.mockResolvedValue(response({ signup: { state: "needs_attention", assignedPhone: "", terminal: false, message: "Do not submit again." } }));
    render({ ...pending(), twilioPhoneNumber: "+12895550123", phoneProvisioning: { status: "ready", e164: "+12895550123" } });
    expect(container.querySelector('a[href="tel:+12895550123"]')).toBeNull();
    await tick();
    await tick(5000);
    expect(container.querySelector('a[href="tel:+12895550123"]')).toBeNull();
    const saved = JSON.parse(window.sessionStorage.getItem(SESSION_KEY));
    expect(saved.twilioPhoneNumber).toBe("");
    expect(saved.phoneProvisioning.e164).toBe("");
    expect(container.textContent).toMatch(/Number setup needs a retry/);
  });

  test("a closed signup is clearly explained and is not polled again", async () => {
    global.fetch.mockResolvedValue(response({ signup: { state: "closed", terminal: true, assignedPhone: "", title: "This pilot signup was not activated.", message: "Contact My AI PA if this was a mistake." } }));
    render();
    await tick();
    expect(container.textContent).toMatch(/This pilot signup was not activated/);
    expect(container.textContent).not.toMatch(/Number assignment is pending/);
    await tick(60000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("a lost connection preserves the signup and manual check gives a useful message", async () => {
    global.fetch.mockRejectedValue(new Error("Connection lost. Your signup is still saved."));
    render();
    await tick();
    await click("Check setup status");
    expect(container.textContent).toMatch(/Connection lost. Your signup is still saved/);
    expect(JSON.parse(window.sessionStorage.getItem(SESSION_KEY)).signupStatus.id).toBe("attempt_synthetic");
    expect(global.fetch.mock.calls.every(([, options]) => !options.method || options.method === "GET")).toBe(true);
  });

  test("support attaches the private signup reference without provisioning again", async () => {
    global.fetch.mockResolvedValue(response({ ok: true, message: "Your support request was received." }, 202));
    render();
    const field = container.querySelector('textarea[aria-label="Describe your signup problem"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    act(() => {
      setter.call(field, "I am waiting for my assigned number.");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Send signup support request");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/signup\/status\/attempt_synthetic\/support$/);
    expect(options.headers["x-signup-status-token"]).toBe("private-status-test-token");
    expect(JSON.parse(options.body)).toEqual({ description: "I am waiting for my assigned number." });
    expect(container.textContent).toMatch(/Your support request was received/);
  });

  test("the polling interval stays below the public status limit during a long wait", async () => {
    global.fetch.mockResolvedValue(response({ signup: { state: "final_checks", terminal: false, assignedPhone: "" } }));
    render();
    for (let i = 0; i < 60; i += 1) await tick();
    expect(global.fetch).toHaveBeenCalledTimes(60);
  });
});

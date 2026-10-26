import React, { act } from "react";
import { createRoot } from "react-dom/client";
import OnboardingWizard from "./OnboardingWizard";
import copy from "./onboardingCopy";
import { readWizardLocation, tokenFromSetupUrl } from "./onboardingApi";

describe("approved three-page receptionist wizard", () => {
  let container, root, originalFetch;
  const forwarding = { id: "fixture", assignedMyAiPaNumber: "+12895550199", carrier: "bell", lineType: "mobile", forwardingStatus: "ready_to_activate", rule: { activationMethod: "DIAL_STRING", activationDialString: "*61*2895550199#", activationTelUri: "tel:*61*2895550199%23", deactivationDialString: "#61#", humanInstructions: ["Wait for your phone company’s confirmation."], warnings: [], supported: true, destinationDigits: "2895550199" } };
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true; window.location.hash = "#/f/fixture"; window.scrollTo = jest.fn();
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ forwarding }) }));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); global.fetch = originalFetch; window.location.hash = ""; jest.restoreAllMocks(); });
  const mount = async (props = {}) => {
    window.history.replaceState(null, "", `#/f/fixture${props.initialStep > 1 ? `?step=${props.initialStep}` : ""}`);
    await act(async () => root.render(<OnboardingWizard token="fixture" forwarding={forwarding} {...props} />));
  };
  const button = text => [...container.querySelectorAll("button")].find(item => item.textContent === text);
  const click = async text => act(async () => button(text).click());

  test("number, exact practice copy, edit and forward actions follow the approved order", async () => {
    await mount();
    const panel = container.querySelector(".onboarding-stage-one");
    expect(panel.querySelector("h1").textContent).toBe(copy.readyTitle);
    expect(panel.querySelector(".onboarding-number-label").textContent).toBe(copy.numberLabel);
    expect(panel.querySelector(".onboarding-number").nextElementSibling).toBe(panel.querySelector(".onboarding-test"));
    expect(panel.textContent).toContain(copy.testInfo);
    expect(panel.querySelector(".onboarding-info-icon").getAttribute("title")).toContain("business-phone forwarding only");
    expect(panel.querySelector(".onboarding-ready-next").nextElementSibling.textContent).toBe(copy.forwardingAction);
    expect(panel.querySelector(`a[href="tel:+12895550199"]`)).not.toBeNull();
    expect(container.querySelectorAll(`a[href="tel:${copy.supportPhone}"]`)).toHaveLength(2);
    expect(panel.textContent).not.toMatch(/Launch checklist|Optional secure billing|Open customer dashboard/);
  });

  test("can proceed to forwarding and reminders without a call, checklist or verified receipt", async () => {
    await mount();
    await click(copy.forwardingAction);
    expect(container.querySelector("h1").textContent).toBe(copy.forwardingTitle);
    expect(container.textContent).toContain(copy.activationBoundary);
    expect(container.textContent).toContain(copy.timing);
    const next = [...container.querySelectorAll("button")].find(item => item.textContent.startsWith(copy.continueReminders));
    expect(next.disabled).toBe(false);
    await act(async () => next.click());
    expect(container.querySelector("h1").textContent).toBe(copy.finalTitle);
    expect(window.location.hash).toContain("step=3");
    expect(global.fetch.mock.calls.every(([, options]) => !options.method || options.method === "GET")).toBe(true);
  });

  test("reminders preserve every approved handwritten paragraph and no additional result/dashboard body", async () => {
    await mount({ initialStep: 3 });
    const panel = container.querySelector(".onboarding-stage-three");
    expect([...panel.querySelectorAll("p")].map(item => item.textContent)).toEqual([copy.finalCall, copy.finalMessages, copy.finalReport, copy.finalReassurance]);
    expect([...panel.querySelectorAll("h2")].map(item => item.textContent)).toEqual([copy.finalReportTitle, copy.finalSupport]);
    expect(panel.querySelectorAll('input,button,[role="checkbox"],[role="status"]')).toHaveLength(0);
    expect(panel.textContent).not.toMatch(/Waiting|Passed|Delivered|Dashboard|Continue|Check call forwarding/);
    expect(panel.querySelector(`a[href="tel:${copy.supportPhone}"]`).textContent).toBe(copy.supportLabel);
  });

  test("dialer records opened intent only and never rewrites it as active", async () => {
    await mount({ initialStep: 2 });
    const activation = container.querySelector(".forwarding-activate");
    expect(activation.getAttribute("href")).toBe("tel:*61*2895550199%23");
    // JSDOM has no OS dialer. Cancel only the test's native default action;
    // the React intent handler and original tel href remain under test.
    activation.addEventListener("click", event => event.preventDefault());
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ forwarding: { ...forwarding, forwardingStatus: "dialer_opened" } }) });
    await act(async () => activation.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(global.fetch.mock.calls.at(-1)[0]).toMatch(/activation-opened$/);
    expect(global.fetch.mock.calls.some(([url]) => url.endsWith("/verify"))).toBe(false);
    expect(container.textContent).not.toMatch(/You’re protected|Protection active|Testing…/);
  });

  test("copying uses the actual number or carrier command, not the photographed example", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mount(); await click(copy.copyNumber);
    expect(writeText).toHaveBeenLastCalledWith("+12895550199");
    await click(copy.forwardingAction); await click(copy.copyCode);
    expect(writeText).toHaveBeenLastCalledWith("*61*2895550199#");
  });

  test("legacy manual state normalizes saved choices only after an explicit dialer press", async () => {
    const legacy = { ...forwarding, carrier: "telus", forwardingStatus: "manual_setup_required" };
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ forwarding: legacy }) });
    await mount({ initialStep: 2, forwarding: legacy });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ forwarding: { ...legacy, forwardingStatus: "ready_to_activate" } }) });
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ forwarding: { ...legacy, forwardingStatus: "dialer_opened" } }) });
    const activation = container.querySelector(".forwarding-activate");
    activation.addEventListener("click", event => event.preventDefault());
    await act(async () => activation.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(global.fetch.mock.calls[1][0]).toMatch(/selections$/);
    expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({ carrier: "telus", lineType: "mobile" });
    expect(global.fetch.mock.calls[2][0]).toMatch(/activation-opened$/);
    expect(global.fetch.mock.calls.some(([url]) => url.endsWith("/verify"))).toBe(false);
  });

  test("existing active setup does not claim nothing is connected and retains disable guidance", async () => {
    const active = { ...forwarding, forwardingStatus: "active" };
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ forwarding: active }) });
    await mount({ forwarding: active });
    expect(container.textContent).not.toContain("nothing is connected");
    await click(copy.forwardingAction);
    expect(container.textContent).toContain("Turn off / view disable instructions");
    expect(container.textContent).toContain("#61#");
    const activation = container.querySelector(".forwarding-activate");
    activation.addEventListener("click", event => event.preventDefault());
    await act(async () => activation.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("edit opens existing-owner authentication in place and returns to the same test", async () => {
    await mount();
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "Owner sign-in required." }) });
    await click(copy.editDetails);
    expect(container.querySelector(".onboarding-editor")).not.toBeNull();
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(global.fetch.mock.calls.at(-1)[1]).toMatchObject({ credentials: "include", headers: { Authorization: "Forwarding fixture" } });
    await click("Return to my receptionist");
    expect(container.querySelector(".onboarding-test")).not.toBeNull();
    expect(container.textContent).toContain("+1 (289) 555-0199");
    expect(global.fetch.mock.calls.some(([url]) => /signup\/submit|provision/.test(url))).toBe(false);
  });

  test("setup and editor query parsing never stores the token or number", () => {
    expect(tokenFromSetupUrl("https://www.myaipa.ca/#/f/private-short-link?step=2")).toBe("private-short-link");
    window.location.hash = "#/forwarding-setup?token=private-token&step=2&edit=1";
    expect(readWizardLocation()).toEqual({ step: 2, edit: true });
    expect(tokenFromSetupUrl(window.location.href)).toBe("private-token");
    expect(window.sessionStorage.length).toBe(0);
  });

  test("a mismatched saved setup removes stale number, Call, Copy and forwarding controls", async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ forwarding: { ...forwarding, assignedMyAiPaNumber: "+12895550222" } }) });
    await mount({ assignedNumber: "+12895550199" });
    expect(container.querySelector('.onboarding-number-value,a[href="tel:+12895550199"],a[href="tel:+12895550222"]')).toBeNull();
    expect(button(copy.copyNumber)).toBeUndefined();
    expect(button(copy.forwardingAction)).toBeUndefined();
    expect(container.textContent).toContain("no longer matches your assigned number");
    await act(async () => container.querySelector('[data-step="2"] button').click());
    expect(container.querySelector('.forwarding-activate')).toBeNull();
    expect(button(copy.forwardingAction).disabled).toBe(true);
  });
});

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ForwardingSetup from "./ForwardingSetup";
import dialerFixture from "./forwardingDialerFixture.json";
import copy from "./features/onboarding/onboardingCopy";

describe("approved signed forwarding-link entry", () => {
  let container, root, originalFetch;
  const forwarding = { id: "fixture", carrier: "not_sure", lineType: "mobile", assignedMyAiPaNumber: "+12895550199", forwardingStatus: "ready_to_activate", rule: { ...dialerFixture, humanInstructions: ["Use unanswered calls only."], warnings: [], supported: true, activationMethod: "DIAL_STRING", destinationDigits: "2895550199" } };
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.location.hash = "#/f/fixture";
    window.scrollTo = jest.fn();
    originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ forwarding }) }));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); window.location.hash = ""; window.sessionStorage.clear(); global.fetch = originalFetch; jest.restoreAllMocks(); });
  const mount = async () => act(async () => root.render(<ForwardingSetup />));

  test("opens with the assigned number and practice immediately underneath, not the old carrier screen", async () => {
    await mount();
    expect(container.querySelector("h1").textContent).toBe(copy.readyTitle);
    expect(container.querySelector(".onboarding-number-value").textContent).toBe("+1 (289) 555-0199");
    expect(container.querySelector(".onboarding-number").nextElementSibling.classList.contains("onboarding-test")).toBe(true);
    expect(container.textContent).toContain(copy.practice);
    expect(container.querySelector("select")).toBeNull();
    expect(container.querySelectorAll(".forwarding-brand svg rect[fill='#ff7a00']")).toHaveLength(7);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe("Forwarding fixture");
  });

  test("explicit step=2 opens real phone-company instructions, preserving the exact tel URI", async () => {
    window.location.hash = "#/f/fixture?step=2";
    await mount();
    expect(container.querySelector("h1").textContent).toBe(copy.forwardingTitle);
    expect(container.querySelector(".forwarding-activate").getAttribute("href")).toBe(dialerFixture.activationTelUri);
    expect(container.querySelector(".forwarding-command strong").textContent).toBe(dialerFixture.activationDialString);
    expect(container.querySelector(".onboarding-instructions").open).toBe(false);
  });

  test("returning from the dialer never starts an outbound verification call, including old saved auto-test state", async () => {
    window.location.hash = "#/f/fixture?step=2";
    window.sessionStorage.setItem("myaipa-forwarding-auto-test:fixture", String(Date.now() - 5000));
    await mount();
    await act(async () => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); document.dispatchEvent(new Event("visibilitychange")); });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toMatch(/Test My Setup|Do not answer the test call|You’re protected/);
    expect(global.fetch.mock.calls.some(([url]) => url.endsWith("/verify"))).toBe(false);
  });

  test.each(["mobile", "landline", "voip"])("%s manual setup never invents a carrier code", async lineType => {
    window.location.hash = "#/f/fixture?step=2";
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ forwarding: { ...forwarding, lineType, rule: { activationMethod: "MANUAL", destinationDigits: "2895550199", humanInstructions: ["Use provider settings for unanswered calls only."], warnings: [], supported: false } } }) });
    await mount();
    expect(container.querySelector(".forwarding-activate")).toBeNull();
    expect(container.textContent).toContain("Copy forwarding number");
    expect(container.textContent).toContain("Use provider settings for unanswered calls only.");
    expect(container.querySelector(".onboarding-instructions").open).toBe(false);
  });
});

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Signup, { HumanVerificationCheck, SIGNUP_QA_PREFILL_STORAGE_KEY, SignupSuccessPage } from "./Signup";

jest.mock("@vapi-ai/web", () => jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  off: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
})));

describe("intuitive signup presentation", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    window.scrollTo = jest.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.localStorage.clear();
    window.location.hash = "";
  });

  test("shows one progress route and one question", () => {
    act(() => root.render(<Signup />));

    expect(container.querySelectorAll(".signup-visible-progress")).toHaveLength(1);
    expect(container.querySelector(".signup-macro-stepper")).toBeNull();
    expect(container.querySelector(".signup-home-row a").getAttribute("href")).toBe("#/");
    expect(container.textContent).toMatch(/Step 1 of 8/i);
    expect(container.textContent).toMatch(/Choose your trade/i);
    expect(container.querySelectorAll(".signup-trade-grid button")).toHaveLength(6);
  });

  test("puts the service-area Next button beside the selected-area count", () => {
    const clickButton = (label, selector = "button") => {
      const button = [...container.querySelectorAll(selector)]
        .find((candidate) => candidate.textContent.includes(label));
      expect(button).toBeDefined();
      act(() => button.click());
      return button;
    };

    act(() => root.render(<Signup />));
    clickButton("Electrician", ".signup-trade-grid button");
    clickButton("Continue to property types", ".signup-mobile-primary");
    clickButton("Residential", ".signup-specialization-grid button");
    clickButton("Continue to service areas", ".signup-mobile-primary");

    const nearbyNext = container.querySelector(".signup-mobile-selected-count .signup-mobile-selected-next");
    expect(nearbyNext).not.toBeNull();
    expect(nearbyNext.textContent).toMatch(/Next/i);
    expect(nearbyNext.disabled).toBe(true);
    expect(container.querySelector(".signup-mobile-action-bar .signup-mobile-primary")).toBeNull();

    clickButton("Whitby", ".signup-area-group-grid button");
    expect(container.querySelector(".signup-mobile-selected-value").textContent).toBe("1");
    expect(nearbyNext.disabled).toBe(false);

    act(() => nearbyNext.click());
    expect(container.textContent).toMatch(/Tell us about your business/i);
  });

  test("renders Turnstile explicitly and returns its verified token", () => {
    const onVerify = jest.fn();
    window.turnstile = {
      render: jest.fn((_element, options) => {
        options.callback("verified-browser-token");
        return "widget-1";
      }),
      remove: jest.fn(),
    };

    act(() => root.render(
      <HumanVerificationCheck provider="turnstile" siteKey="test-site-key" onVerify={onVerify} />
    ));

    expect(container.querySelector('[data-testid="turnstile-container"]')).not.toBeNull();
    expect(window.turnstile.render).toHaveBeenCalledTimes(1);
    expect(onVerify).toHaveBeenCalledWith("verified-browser-token");
    delete window.turnstile;
  });

  test("loads the Turnstile QA route with stored contact overrides and no manual contact typing", () => {
    window.location.hash = "#/signup?qa=turnstile";
    window.localStorage.setItem(SIGNUP_QA_PREFILL_STORAGE_KEY, JSON.stringify({
      phone: "9055550138",
      email: "qa-run@myaipa.ca",
    }));

    act(() => root.render(<Signup />));

    expect(container.textContent).toMatch(/Final review/i);
    expect(container.textContent).toMatch(/QA Painter Services/i);
    expect(container.textContent).toMatch(/9055550138/i);
    expect(container.textContent).toMatch(/qa-run@myaipa.ca/i);
    expect(container.textContent).toMatch(/QA prefill loaded/i);
    expect(container.textContent).not.toMatch(/Enter a real 10-digit business phone number/i);
  });

  test.each([
    ["skipped", { stripeTrialSkipped: true }],
    ["failed", { stripeTrialError: "Stripe trial subscription could not be created." }],
  ])("does not claim the free trial is active when Stripe %s activation", (_outcome, stripeResult) => {
    act(() => root.render(
      <SignupSuccessPage
        result={{
          businessName: "Pilot Electrical",
          twilioPhoneNumber: "+12895550123",
          phoneProvisioning: { status: "ready", e164: "+12895550123" },
          ...stripeResult,
        }}
        onStartAnother={jest.fn()}
        onRetry={jest.fn()}
      />
    ));

    expect(container.textContent).not.toMatch(/Free trial active/i);
    expect(container.textContent).not.toMatch(/Your 14-day trial has started/i);
    expect(container.textContent).toMatch(/Trial activation needs attention/i);
    expect(container.textContent).toMatch(/Stripe did not confirm a trial/i);
  });

  test("shows the free trial as active only after Stripe confirms a trialing subscription", () => {
    act(() => root.render(
      <SignupSuccessPage
        result={{
          businessName: "Pilot Electrical",
          twilioPhoneNumber: "+12895550123",
          phoneProvisioning: { status: "ready", e164: "+12895550123" },
          subscriptionId: "sub_pilot_123",
          subscriptionStatus: "trialing",
          stripeTrialSkipped: false,
          stripeTrialError: "",
        }}
        onStartAnother={jest.fn()}
        onRetry={jest.fn()}
      />
    ));

    expect(container.textContent).toMatch(/Free trial active/i);
    expect(container.textContent).toMatch(/Your 14-day trial has started/i);
    expect(container.textContent).not.toMatch(/Trial activation needs attention/i);
  });
});

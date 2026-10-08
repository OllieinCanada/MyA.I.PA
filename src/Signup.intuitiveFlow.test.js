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
    expect(container.querySelector(".signup-mobile-offer").textContent).toMatch(/14-day free trial.*No credit card required for the trial.*Cancel anytime/i);
    expect(container.textContent).toMatch(/Step 1 of 8/i);
    expect(container.textContent).toMatch(/Choose your trade/i);
    expect(container.querySelectorAll(".signup-trade-grid button")).toHaveLength(6);
    const topContinue = container.querySelector(".signup-trade-top-continue");
    expect(topContinue).not.toBeNull();
    expect(topContinue.classList.contains("sm:hidden")).toBe(false);
    expect(topContinue.compareDocumentPosition(container.querySelector(".signup-trade-grid")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("continues past service-call pricing after both prices are entered", () => {
    act(() => root.render(<Signup />));
    const form = container.querySelector("form");
    const submit = () => act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    const clickButton = (text, within = container) => {
      const button = Array.from(within.querySelectorAll("button")).find((item) => item.textContent.trim() === text);
      expect(button).not.toBeUndefined();
      act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    };
    const changeValue = (selector, value) => {
      const field = container.querySelector(selector);
      expect(field).not.toBeNull();
      const prototype = field.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
      act(() => {
        setter.call(field, value);
        field.dispatchEvent(new Event("change", { bubbles: true }));
        field.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };

    clickButton("Electrician", container.querySelector(".signup-trade-grid"));
    submit();
    clickButton("Residential", container.querySelector(".signup-specialization-grid"));
    submit();
    const areaList = container.querySelector(".signup-area-list");
    const unlistedAreaPanel = container.querySelector(".signup-area-tools");
    const areaNext = container.querySelector(".signup-mobile-selected-count .signup-mobile-area-next");
    expect(areaList.contains(unlistedAreaPanel)).toBe(false);
    expect(areaNext).not.toBeNull();
    expect(areaNext.textContent.trim()).toBe("Next");
    expect(areaNext.disabled).toBe(true);
    expect(container.querySelector(".signup-mobile-action-bar .signup-mobile-primary")).toBeNull();
    expect(container.querySelector('input[type="search"]')).toBeNull();
    expect(container.querySelector("#custom-service-area")).toBeNull();
    act(() => unlistedAreaPanel.querySelector('button[aria-controls="custom-service-area-panel"]').dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(unlistedAreaPanel.querySelector('button[aria-expanded="true"]')).not.toBeNull();
    expect(container.querySelector("#custom-service-area")).not.toBeNull();
    changeValue("#custom-service-area", "Beamsville");
    clickButton("Add area", unlistedAreaPanel);
    expect(container.querySelector("#custom-service-area")).toBeNull();
    expect(areaList.textContent).toMatch(/Added by you.*Beamsville/i);
    expect(areaNext.disabled).toBe(false);
    clickButton("Hamilton", container.querySelector(".signup-area-list"));
    clickButton("Next", container.querySelector(".signup-mobile-selected-count"));

    expect(container.textContent).not.toMatch(/Who provides your business phone|What kind of number is it|Why we ask for your business address/i);
    expect(container.textContent).toMatch(/Continue to service call pricing/i);

    changeValue("#your-name-input", "Oliver Arscott");
    changeValue("#business-name-input", "Arscott Electric");
    changeValue("#business-phone-number-input", "9057885488");
    changeValue("#email-address-input", "oliver@arscottelectric.ca");
    changeValue("#street-address-input", "91 Mountain Road");
    changeValue("#city-input", "Hamilton");
    changeValue("#province-select", "ON");
    changeValue("#postal-code-input", "L8P 1A1");
    submit();

    expect(container.textContent).toMatch(/Step 5 of 8/i);
    expect(container.textContent).toMatch(/What should your assistant include\?/i);
    const pricingChoices = () => Array.from(container.querySelectorAll('#signup-pricing input[type="checkbox"]'));
    expect(pricingChoices()).toHaveLength(5);
    expect(pricingChoices().every((checkbox) => !checkbox.checked)).toBe(true);
    expect(container.querySelector(".signup-mobile-primary").disabled).toBe(false);
    act(() => pricingChoices()[0].click());
    expect(container.querySelector(".signup-mobile-primary").disabled).toBe(true);
    expect(container.querySelector("#hourly-labour-rate-input")).toBeNull();
    expect(container.textContent).toMatch(/Parts are extra/);
    changeValue("#minimum-service-visit-fee-input", "125");
    expect(container.querySelector(".signup-mobile-primary").disabled).toBe(false);
    act(() => pricingChoices()[1].click());
    submit();
    expect(container.textContent).toMatch(/Enter a price for each checked rate/i);

    changeValue("#hourly-labour-rate-input", "95");
    submit();
    expect(container.textContent).toMatch(/Step 6 of 8/i);
    expect(container.textContent).toMatch(/Check your setup/i);
    expect(container.textContent).not.toMatch(/Assistant voice|voice preview/i);
    submit();
    expect(container.textContent).toMatch(/Step 7 of 8/i);
    expect(container.textContent).toMatch(/Final review/i);
    expect(container.querySelector(".signup-review-step")).not.toBeNull();
    clickButton("Change", container.querySelector(".signup-review-step"));
    expect(container.textContent).toMatch(/Choose your trade/i);
    clickButton("Plumber", container.querySelector(".signup-trade-grid"));
    expect(container.querySelector(".signup-trade-top-continue").textContent).toMatch(/Continue/);
    submit();
    expect(container.textContent).toMatch(/Step 7 of 8/i);
    expect(container.querySelector(".signup-specialization-grid")).toBeNull();
    expect(container.querySelector(".signup-review-step").textContent).toMatch(/Plumber/);
    expect(container.querySelector(".signup-review-step").textContent).toMatch(/Residential/);
    expect(container.querySelector(".signup-review-step").textContent).toMatch(/Hamilton/);
    expect(container.querySelector(".signup-review-step").textContent).toMatch(/Beamsville/);
    expect(container.querySelector(".signup-review-step").textContent).toMatch(/125/);
    expect(container.querySelector(".signup-review-step").textContent).toMatch(/95/);
    expect(container.querySelector(".signup-review-step")).not.toBeNull();
    clickButton("Change", container.querySelector(".signup-review-step"));
    act(() => container.querySelector(".signup-mobile-back").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toMatch(/Step 7 of 8/i);
    act(() => container.querySelector(".signup-mobile-back").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container.textContent).toMatch(/Step 6 of 8/i);
    clickButton("Change", container.querySelector(".signup-task-content"));
    clickButton("Painter", container.querySelector(".signup-trade-grid"));
    submit();
    expect(container.textContent).toMatch(/Step 6 of 8/i);
    expect(container.querySelector(".signup-specialization-grid")).toBeNull();
    expect(container.textContent).toMatch(/Residential/);
    expect(container.textContent).toMatch(/Arscott Electric/);
  });

  test("shows personalized phone verification without welcoming an unfinished setup", () => {
    act(() => root.render(<SignupSuccessPage result={{businessName: "Mcdoober Electrical", verificationRequired: true}} onStartAnother={jest.fn()} onRetry={jest.fn()} />));
    expect(container.textContent).toMatch(/Step 8 of 8 · Phone verification/i);
    expect(container.textContent).toMatch(/Thanks, Mcdoober Electrical/i);
    expect(container.textContent).toMatch(/Open the verification link in your text messages/i);
    expect(container.textContent).not.toMatch(/Welcome aboard/i);
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
      phone: "9057885488",
      email: "qa-run@myaipa.ca",
    }));

    act(() => root.render(<Signup />));

    expect(container.textContent).toMatch(/Final review/i);
    expect(container.textContent).toMatch(/QA Painter Services/i);
    expect(container.textContent).toMatch(/9057885488/i);
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

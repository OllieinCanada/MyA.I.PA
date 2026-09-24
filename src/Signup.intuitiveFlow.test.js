import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Signup, { HumanVerificationCheck, SignupSuccessPage } from "./Signup";

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
    expect(container.textContent).toMatch(/Do you want your agent to discuss prices and hourly rates for service calls or repairs\?/i);
    expect(container.querySelector(".signup-mobile-primary").disabled).toBe(true);

    clickButton("Yes", container.querySelector('[role="group"]'));
    expect(container.querySelector(".signup-mobile-primary").disabled).toBe(false);
    changeValue("#service-call-repair-price-input", "125");
    submit();
    expect(container.textContent).toMatch(/Enter both the service-call or repair price and the hourly rate/i);
    expect(container.textContent).toMatch(/Enter the hourly rate/i);

    changeValue("#hourly-rate-input", "95");
    submit();
    expect(container.textContent).toMatch(/Step 6 of 8/i);
    expect(container.textContent).toMatch(/Setup summary/i);
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

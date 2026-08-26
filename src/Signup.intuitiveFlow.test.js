import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Signup, { SignupSuccessPage } from "./Signup";

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
    expect(container.textContent).toMatch(/Step 1 of 8/i);
    expect(container.textContent).toMatch(/Choose your trade/i);
    expect(container.querySelectorAll(".signup-trade-grid button")).toHaveLength(6);
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

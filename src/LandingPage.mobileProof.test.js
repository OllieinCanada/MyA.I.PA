import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MobileHeroCallProof } from "./LandingPage";

describe("responsive three-sided homepage proof", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    global.IntersectionObserver = class IntersectionObserver {
      constructor(callback) {
        this.callback = callback;
      }

      observe() {
        this.callback([{ isIntersecting: true, intersectionRatio: 1 }]);
      }

      disconnect() {}
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("advances every side after 14 seconds without pause controls", () => {
    act(() => root.render(<MobileHeroCallProof />));
    const proof = container.querySelector('[role="region"]');

    expect(proof.getAttribute("aria-label")).toMatch(/Side 1 of 3.*14 seconds/i);
    expect(container.textContent).not.toMatch(/Auto-advances|Rotation paused|Pause/i);

    act(() => jest.advanceTimersByTime(13999));
    expect(proof.getAttribute("aria-label")).toMatch(/Side 1 of 3/i);
    act(() => jest.advanceTimersByTime(1));
    expect(proof.getAttribute("aria-label")).toMatch(/Side 2 of 3/i);

    act(() => jest.advanceTimersByTime(13999));
    expect(proof.getAttribute("aria-label")).toMatch(/Side 2 of 3/i);
    act(() => jest.advanceTimersByTime(1));
    expect(proof.getAttribute("aria-label")).toMatch(/Side 3 of 3/i);
  });

  test("puts both actions beneath the card without advancing it", () => {
    const onSampleCall = jest.fn();
    const onStartTrial = jest.fn();
    act(() => root.render(
      <MobileHeroCallProof onSampleCall={onSampleCall} onStartTrial={onStartTrial} />,
    ));
    const proof = container.querySelector('[role="region"]');
    const sample = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Sample Call"));
    const signup = Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Free Trial"));

    act(() => sample.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => signup.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onSampleCall).toHaveBeenCalledTimes(1);
    expect(onStartTrial).toHaveBeenCalledTimes(1);
    expect(proof.getAttribute("aria-label")).toMatch(/Side 1 of 3/i);
  });

  test("shows readable dual-phone details, complete gripping hands and coffee marks", () => {
    act(() => root.render(<MobileHeroCallProof />));

    expect(container.querySelectorAll(".landing-text-phone")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-reading-hand")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-reading-hand-finger")).toHaveLength(8);
    expect(container.querySelectorAll(".landing-reading-hand-thumb")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-coffee-steam path")).toHaveLength(3);
    expect(container.querySelectorAll(".landing-coffee-underline path")).toHaveLength(2);
    expect(container.textContent).toMatch(/Owner's cellphone/i);
    expect(container.textContent).toMatch(/Customer's cellphone/i);
  });
});

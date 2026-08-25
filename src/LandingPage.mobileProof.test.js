import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  HeroActionFlow,
  HeroCoveragePromise,
  HeroIntroduction,
  HeroLiveCallButton,
  HeroNoteBenefits,
  LandingStoryIntroduction,
  MobileHeroCallProof,
} from "./LandingPage";

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

  test("switches every 7 seconds and Pause holds the screen for 14 seconds", () => {
    act(() => root.render(<MobileHeroCallProof />));
    const proof = container.querySelector('[role="region"]');
    const pause = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Pause");

    expect(proof.getAttribute("aria-label")).toMatch(/Side 1 of 3.*7 seconds.*14 seconds/i);
    expect(container.textContent).toMatch(/Switches every 7 seconds/i);
    expect(container.textContent).toMatch(/Pause button holds screen for 14 seconds/i);

    act(() => jest.advanceTimersByTime(6999));
    expect(proof.getAttribute("aria-label")).toMatch(/Side 1 of 3/i);
    act(() => jest.advanceTimersByTime(1));
    expect(proof.getAttribute("aria-label")).toMatch(/Side 2 of 3/i);

    act(() => pause.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(pause.textContent).toBe("Holding");
    act(() => jest.advanceTimersByTime(14000));
    expect(proof.getAttribute("aria-label")).toMatch(/Side 2 of 3/i);
    act(() => jest.advanceTimersByTime(7000));
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

  test("gives phone and tablet layouts an accessible recorded-call control", () => {
    const onClick = jest.fn();
    act(() => root.render(<HeroLiveCallButton onClick={onClick} audioPlaying={false} />));

    const button = container.querySelector("button");
    expect(button.textContent).toMatch(/Hear Live Call/i);
    expect(button.getAttribute("aria-label")).toMatch(/recorded Tim's Electrical live-call demonstration/i);
    expect(button.getAttribute("aria-pressed")).toBe("false");

    act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClick).toHaveBeenCalledTimes(1);

    act(() => root.render(<HeroLiveCallButton onClick={onClick} audioPlaying />));
    expect(container.querySelector("button").textContent).toMatch(/Pause Live Call/i);
    expect(container.querySelector("button").getAttribute("aria-pressed")).toBe("true");
  });

  test("explains the missed-call workflow with action icons instead of numbered steps", () => {
    act(() => root.render(<HeroActionFlow />));

    expect(container.textContent).toMatch(/MY AI PA:/i);
    expect(container.textContent).toMatch(/Answers after 3 rings/i);
    expect(container.textContent).toMatch(/Captures important call details/i);
    expect(container.textContent).toMatch(/Sends text summary and follow-up/i);
    expect(container.querySelectorAll(".landing-action-flow-icon")).toHaveLength(3);
    expect(container.querySelectorAll(".landing-action-flow-arrow")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-action-flow-step b")).toHaveLength(0);
  });

  test("restores the complete handwritten hero message as shared responsive content", () => {
    act(() => root.render(
      <>
        <HeroIntroduction />
        <p>Never miss a call again!</p>
        <p>Missed Calls = Lost Jobs $$</p>
        <HeroCoveragePromise />
        <HeroNoteBenefits />
      </>,
    ));

    expect(container.textContent).toMatch(/IntroducingMy AI PA:AI Telephone Answering Assistant/i);
    expect(container.textContent).toMatch(/Never miss a call again!/i);
    expect(container.textContent).toMatch(/Missed Calls = Lost Jobs \$\$/i);
    expect(container.textContent).toMatch(/We've got you covered 24\/7/i);
    expect(container.textContent).toMatch(/price of a cup of coffee per day/i);
    expect(container.textContent).toMatch(/All calls answered professionally after 3 rings/i);
    expect(container.textContent).toMatch(/Natural dialogue with customers to create a connection/i);
    expect(container.textContent).toMatch(/FAQ questions answered/i);
    expect(container.textContent).toMatch(/Job details and callback information texted to you/i);
    expect(container.textContent).toMatch(/Complete customer information collected/i);
    expect(container.textContent).toMatch(/thank-you text\/reminder sent to the customer/i);
    expect(container.querySelectorAll(".landing-hero-note-benefit")).toHaveLength(6);

    const introduction = container.querySelector(".landing-hero-introduction");
    const identity = introduction.querySelector(".landing-hero-introduction-identity");
    expect(introduction.children).toHaveLength(2);
    expect(identity.querySelector(".landing-hero-introduction-brand").textContent).toBe("My AI PA:");
    expect(identity.querySelector(".landing-hero-introduction-description").textContent).toBe("AI Telephone Answering Assistant");
  });

  test("supports a real horizontal swipe between story faces", () => {
    act(() => root.render(<MobileHeroCallProof />));
    const proof = container.querySelector('[role="region"]');

    act(() => proof.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 320 })));
    act(() => proof.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 120 })));

    expect(proof.getAttribute("aria-label")).toMatch(/Side 2 of 3/i);
  });

  test("shows readable dual-phone details, connected gripping hands and coffee marks", () => {
    act(() => root.render(<MobileHeroCallProof />));

    expect(container.querySelectorAll(".landing-text-phone")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-text-phone-holder")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-reading-hand")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-reading-hand-shape")).toHaveLength(2);
    expect(container.querySelectorAll(".landing-reading-hand-back, .landing-reading-hand-front")).toHaveLength(0);
    expect(container.querySelectorAll(".landing-reading-hand-thumb")).toHaveLength(0);
    expect(container.querySelectorAll(".landing-coffee-steam path")).toHaveLength(3);
    expect(container.querySelectorAll(".landing-coffee-underline path")).toHaveLength(2);
    expect(container.textContent).toMatch(/Owners cell phone/i);
    expect(container.textContent).toMatch(/Customer's cell phone/i);
  });

  test("restores every handwritten how-it-works instruction responsively", () => {
    act(() => root.render(<LandingStoryIntroduction />));

    expect(container.textContent).toMatch(/Keep your same business number!/i);
    expect(container.textContent).toMatch(/They are engaged in conversation and their FAQ's answered with custom answers supplied by you\./i);
    expect(container.textContent).toMatch(/The reason for the call/i);
    expect(container.textContent).toMatch(/Service amount/i);
    expect(container.textContent).toMatch(/And call back # are all collected/i);
    expect(container.textContent).toMatch(/Caller and owner both get a text to their cellphone summarizing the details of the call/i);
    expect(container.textContent).toMatch(/Rates for service work can be added here followed by the question “Would you like to continue” eliminating time wasters\./i);
    expect(container.textContent).toMatch(/Your installation request has been forwarded to team/i);
    expect(container.textContent).toMatch(/Have a great day!/i);
    expect(container.querySelectorAll(".landing-how-phone")).toHaveLength(2);
  });
});

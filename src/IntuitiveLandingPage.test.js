import React, { act } from "react";
import { createRoot } from "react-dom/client";
import IntuitiveLandingPage from "./IntuitiveLandingPage";

describe("intuitive homepage journey", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = jest.fn().mockReturnValue({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    window.scrollTo = jest.fn();
    Element.prototype.scrollTo = jest.fn();
    window.HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = jest.fn();
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

  test("uses the existing message in one clear sales journey", () => {
    act(() => root.render(<IntuitiveLandingPage />));

    const text = container.textContent;
    expect(text).toMatch(/AttentionContractors!/i);
    expect(text).toMatch(/IntroducingMy AI PA:\s*AI Telephone Answering Assistant/i);
    expect(text).toMatch(/Never miss a call again!/i);
    expect(text).toMatch(/Missed Calls = Lost Revenue \$\$/i);
    expect(text).toMatch(/When you can't get to the phone, My AI PA:/i);
    expect(text).toMatch(/Keep your existing business number/i);
    expect(text).toMatch(/Three simple steps/i);
    expect(text).toMatch(/The caller needs help now—not after you finish the job/i);
    expect(text).toMatch(/AnswersAfter 3 rings/i);
    expect(text).toMatch(/Talks naturallyTo get job details/i);
    expect(text).toMatch(/Follows upTexts you and the caller/i);
    expect(container.querySelectorAll(".simple-hero-flow-icon")).toHaveLength(3);
    expect(container.querySelector(".simple-control-strip")).toBeNull();
    expect(text).toMatch(/Trust it privately before a customer ever hears it/i);
    expect(text).toMatch(/No fake promises\. Hear it, test it, and decide from the calls/i);
    expect(text).toMatch(/Now watch a service call become a useful summary/i);
    expect(text).toMatch(/One plan\. Clear minutes\. No long contract/i);

    const sectionIds = Array.from(container.querySelectorAll("section[id], div[id='see-it-work']")).map((node) => node.id);
    expect(sectionIds.indexOf("why-it-matters")).toBeLessThan(sectionIds.indexOf("how-it-works"));
    expect(sectionIds.indexOf("how-it-works")).toBeLessThan(sectionIds.indexOf("see-it-work"));
    expect(sectionIds.indexOf("see-it-work")).toBeLessThan(sectionIds.indexOf("pricing"));
  });

  test("keeps trial and live-call actions easy to find", () => {
    act(() => root.render(<IntuitiveLandingPage />));

    expect(Array.from(container.querySelectorAll("button")).filter((button) => /Start Your Free Trial/i.test(button.textContent)).length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('a[href="tel:+12495033301"]')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="Quick page navigation"] a[href="#how-it-works"]')).not.toBeNull();
    expect(container.querySelectorAll('nav[aria-label="Quick page navigation"] a')).toHaveLength(3);
    expect(container.querySelector('nav[aria-label="Quick page navigation"] a[aria-current="step"]')?.textContent).toMatch(/01Why it matters/i);
    expect(container.querySelector("#why-it-matters .simple-section-heading > span")).toBeNull();
    expect(container.querySelectorAll(".simple-how-details li")).toHaveLength(6);
  });

  test("restores the three-part animated proof and starts audio only when pressed", async () => {
    act(() => root.render(<IntuitiveLandingPage />));

    const carousel = container.querySelector('[aria-label^="Three-part missed-call demonstration"]');
    const hearCall = Array.from(container.querySelectorAll("button")).find((button) => /Hear Live Call/i.test(button.textContent));

    expect(carousel).not.toBeNull();
    expect(carousel.getAttribute("aria-label")).toMatch(/Slide 1 of 3/i);
    expect(container.textContent).toMatch(/A real conversation—not voicemail/i);
    expect(container.textContent).toMatch(/Both sides get a clear text/i);
    expect(container.textContent).toMatch(/Coverage for about a cup of coffee a day/i);
    expect(container.textContent).toMatch(/Natural conversation and FAQ answers/i);
    expect(container.querySelector("#why-it-matters").textContent).toMatch(/First question: Why not just stick to voice mail\?/i);
    expect(container.querySelectorAll(".simple-message-phone")).toHaveLength(2);
    expect(container.querySelector('audio[src*="tims-electrical-2.wav"]')).not.toBeNull();
    expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    await act(async () => hearCall.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(hearCall.textContent).toMatch(/Pause Call/i);
  });
});

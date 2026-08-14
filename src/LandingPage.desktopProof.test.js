import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HeroCallDashboard } from "./LandingPage";

describe("desktop missed-call example", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("pairs the two follow-up outcomes without decorative arrows", () => {
    act(() => root.render(
      <HeroCallDashboard
        audioDuration={135}
        audioPlaying={false}
        audioTime={0}
        demoRevealed
        onRevealDemo={jest.fn()}
        onToggleAudio={jest.fn()}
      />,
    ));

    expect(container.querySelectorAll(".landing-followup-card")).toHaveLength(2);
    expect(container.textContent).toMatch(/Owner lead summary/i);
    expect(container.textContent).toMatch(/Caller confirmation/i);
    expect(container.textContent).toMatch(/One organized lead summary for you/i);
    expect(container.querySelector(".landing-owner-text-arrow")).toBeNull();
    expect(container.querySelector(".landing-lead-note svg")).toBeNull();
  });

  test("starts with an empty transcript and types each turn with the recording", () => {
    const renderAt = (audioTime, audioPlaying = true) => {
      act(() => root.render(
        <HeroCallDashboard
          audioDuration={44.44}
          audioPlaying={audioPlaying}
          audioTime={audioTime}
          demoRevealed
          onRevealDemo={jest.fn()}
          onToggleAudio={jest.fn()}
        />,
      ));
    };

    renderAt(0, false);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(0);

    renderAt(1.4);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(1);
    expect(container.textContent).toContain("Hello are you");
    expect(container.textContent).not.toContain("maintenance today?");
    expect(container.querySelector(".landing-call-transcript-caret")).not.toBeNull();

    renderAt(5.6);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(2);
    expect(container.textContent).toContain("Hello are you looking for a new installation, repair or maintenance today?");
    expect(container.textContent).toContain("I need someone");
    expect(container.textContent).not.toContain("Can I get your first name?");

    renderAt(44.44, false);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(13);
    expect(container.textContent).toContain("Repeating that back, nine oh five, five five five, one two three four. Is that correct?");
    expect(container.textContent).toContain("I have the details ready for the team. Thanks for calling.");
    expect(container.querySelector(".landing-call-transcript-caret")).toBeNull();
  });

  test("keeps the detailed call dormant behind a preview until requested", () => {
    const onRevealDemo = jest.fn();
    const onToggleAudio = jest.fn();

    act(() => root.render(
      <HeroCallDashboard
        audioDuration={44.44}
        audioPlaying={false}
        audioTime={0}
        demoRevealed={false}
        onRevealDemo={onRevealDemo}
        onToggleAudio={onToggleAudio}
      />,
    ));

    expect(container.textContent).toMatch(/Sample call preview/i);
    expect(container.textContent).toMatch(/Hello are you looking for a new installation, repair or maintenance today/i);
    expect(container.textContent).toMatch(/The recording starts only when you press the button/i);
    expect(container.querySelector(".landing-call-dashboard-layout").getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(0);

    const revealButton = Array.from(container.querySelectorAll("button"))
      .find((button) => /See & hear the full call/i.test(button.textContent));
    act(() => revealButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(onRevealDemo).toHaveBeenCalledTimes(1);
    expect(onToggleAudio).not.toHaveBeenCalled();
  });
});

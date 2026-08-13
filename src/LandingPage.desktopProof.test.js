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
          audioDuration={18.08}
          audioPlaying={audioPlaying}
          audioTime={audioTime}
          onToggleAudio={jest.fn()}
        />,
      ));
    };

    renderAt(0, false);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(0);

    renderAt(1.4);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(1);
    expect(container.textContent).toContain("Hi, I'm putting in");
    expect(container.textContent).not.toContain("and need it wired.");
    expect(container.querySelector(".landing-call-transcript-caret")).not.toBeNull();

    renderAt(3.6);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(2);
    expect(container.textContent).toContain("Hi, I'm putting in a hot tub and need it wired.");
    expect(container.textContent).not.toContain("Next week.");

    renderAt(18.08, false);
    expect(container.querySelectorAll(".landing-call-transcript-turn")).toHaveLength(4);
    expect(container.textContent).toContain("Thanks, Brian. I'll pass the installation details and callback preference to the team.");
    expect(container.querySelector(".landing-call-transcript-caret")).toBeNull();
  });
});

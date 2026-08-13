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
});

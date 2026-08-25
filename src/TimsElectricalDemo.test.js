import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  buildTranscriptTimeline,
  getActiveTranscriptIndex,
  TimsElectricalLiveDemo,
} from "./TimsElectricalDemo";

describe("Tim's Electrical preloaded landing-page demo", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.scrollTo = jest.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<TimsElectricalLiveDemo embedded />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test("automatically builds the selected scenario without a separate start button", () => {
    expect(container.textContent).not.toMatch(/Start voice demo/i);
    expect(container.textContent).toMatch(/Homeowner needs a hot tub wired/i);
    expect(container.textContent).toMatch(/Summary builds during the call/i);
    expect(container.textContent).not.toMatch(/NEW INSTALLATIONBrian Smith/i);

    act(() => jest.advanceTimersByTime(6500));

    expect(container.textContent).toMatch(/NEW INSTALLATIONBrian Smith/i);
    expect(container.textContent).toMatch(/Owner's cellphone/i);
    expect(container.textContent).toMatch(/100%/i);
  });

  test("clicking a scenario restarts the automatic call-to-summary sequence", () => {
    act(() => jest.advanceTimersByTime(4000));
    const repairButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Repair request",
    );

    act(() => repairButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toMatch(/Homeowner reports an outlet stopped working/i);
    expect(container.textContent).not.toMatch(/NEW INSTALLATIONBrian Smith/i);
    expect(container.textContent).not.toMatch(/REPAIR REQUESTMaya Chen/i);

    act(() => jest.advanceTimersByTime(6500));

    expect(container.textContent).toMatch(/REPAIR REQUESTMaya Chen/i);
    expect(container.textContent).toMatch(/100%/i);
  });

  test("uses accessible tabs and phone-shaped text previews", () => {
    const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
    expect(tabs).toHaveLength(6);
    expect(tabs[0].getAttribute("aria-controls")).toBe("tims-scenario-panel");
    expect(container.querySelector('[role="tabpanel"]')).not.toBeNull();

    act(() => jest.advanceTimersByTime(4000));

    expect(container.textContent).toMatch(/Owner's cellphone/i);
    expect(container.textContent).toMatch(/Customer's cellphone/i);
    expect(container.querySelectorAll(".tims-message-preview")).toHaveLength(2);
    expect(container.textContent).not.toMatch(/Create task/i);
    expect(container.textContent).not.toMatch(/^Email$/i);
  });

  test("shows captured fields as the transcript reaches them", () => {
    expect(container.textContent).toMatch(/Listening for the request/i);
    expect(container.textContent).not.toMatch(/Job address23 Robb Street/i);

    act(() => jest.advanceTimersByTime(2100));

    expect(container.textContent).toMatch(/IntentNew installation/i);
    expect(container.textContent).toMatch(/CustomerBrian Smith/i);
    expect(container.textContent).toMatch(/Job address23 Robb Street, Hamilton/i);
  });

  test("connects the selected scenario to a clearly disclosed recording", () => {
    const phone = container.querySelector(".fcr-phone-shell");
    const audio = phone.querySelector(".tims-scenario-recording audio");
    expect(container.textContent).toMatch(/Recorded scenario call/i);
    expect(container.textContent).toMatch(/no real customer information/i);
    expect(audio).not.toBeNull();
    expect(audio.getAttribute("src")).toMatch(/audio\/tims-electrical\/new-installation\.wav/i);
    expect(phone.querySelector(".tims-voice-visualizer")).not.toBeNull();
    expect(phone.querySelector('button[aria-label="Play recorded scenario call"]')).not.toBeNull();
    expect(container.querySelector(".fcr-call-console > .tims-scenario-recording")).toBeNull();

    const repairButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Repair request",
    );
    act(() => repairButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toMatch(/Hear the repair request conversation/i);
    expect(container.querySelector(".tims-scenario-recording audio")?.getAttribute("src"))
      .toMatch(/audio\/tims-electrical\/repair-request\.wav/i);
  });

  test("maps recording progress to a natural transcript flow", () => {
    const transcript = [
      { text: "A short greeting." },
      { text: "This is a noticeably longer caller explanation with several details included." },
      { text: "A final recap." },
    ];
    const timeline = buildTranscriptTimeline(transcript, 60);

    expect(timeline).toHaveLength(3);
    expect(timeline[0].start).toBe(0);
    expect(timeline[2].end).toBeCloseTo(60, 5);
    expect(timeline[1].end - timeline[1].start).toBeGreaterThan(timeline[0].end - timeline[0].start);
    expect(getActiveTranscriptIndex(timeline, 0)).toBe(0);
    expect(getActiveTranscriptIndex(timeline, timeline[1].start + 0.1)).toBe(1);
    expect(getActiveTranscriptIndex(timeline, 60)).toBe(2);
  });

  test("uses measured timestamps when a recorded transcript provides them", () => {
    const transcript = [
      { text: "Greeting", startSeconds: 0.75 },
      { text: "Caller request", startSeconds: 11 },
      { text: "Follow-up question", startSeconds: 17.55 },
    ];
    const timeline = buildTranscriptTimeline(transcript, 25);

    expect(timeline).toEqual([
      { index: 0, start: 0.75, end: 11 },
      { index: 1, start: 11, end: 17.55 },
      { index: 2, start: 17.55, end: 25 },
    ]);
    expect(getActiveTranscriptIndex(timeline, 12)).toBe(1);
    expect(getActiveTranscriptIndex(timeline, 18)).toBe(2);
  });

  test("shows the words spoken in the selected Tim's recording", () => {
    act(() => jest.advanceTimersByTime(5000));

    expect(container.textContent).toMatch(/licensed electrician to wire a newly installed hot tub/i);
    expect(container.textContent).toMatch(/23 Robb Street in Hamilton/i);
    expect(container.textContent).toMatch(/905-555-1234/i);
    expect(container.textContent).not.toMatch(/63 York Street/i);
  });

  test("moves the active caption at the recorded speaker-change time", () => {
    const position = container.querySelector('input[aria-label="Recorded call position"]');
    const setRangeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    act(() => {
      setRangeValue.call(position, "12");
      position.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const activeTurn = container.querySelector('.tims-call-turn[data-active="true"]');
    expect(activeTurn?.textContent).toMatch(/CALLER/i);
    expect(activeTurn?.textContent).toMatch(/licensed electrician to wire a newly installed hot tub/i);
  });
});

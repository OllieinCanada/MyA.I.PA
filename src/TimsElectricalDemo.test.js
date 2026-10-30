import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  buildTranscriptTimeline,
  getActiveTranscriptIndex,
  TimsElectricalLiveDemo,
} from "./TimsElectricalDemo";
import { reportClientError } from "./clientErrorReporter";
jest.mock('./clientErrorReporter', () => ({ ...jest.requireActual('./clientErrorReporter'), reportClientError: jest.fn() }));

describe("Tim's Electrical preloaded landing-page demo", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    global.IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.scrollTo = jest.fn();
    HTMLMediaElement.prototype.play = jest.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = jest.fn();
    HTMLMediaElement.prototype.load = jest.fn();
    jest.clearAllMocks();
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
    expect(container.textContent).not.toMatch(/NEW INSTALLATIONJob type: New installationBrian Smith/i);

    act(() => jest.advanceTimersByTime(6500));

    expect(container.textContent).toMatch(/NEW INSTALLATIONJob type: New installationBrian Smith/i);
    container.querySelectorAll(".tims-message-preview").forEach((phone) => {
      expect(phone.textContent).toMatch(/Job type: New installation/i);
    });
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
    expect(container.textContent).not.toMatch(/NEW INSTALLATIONJob type: New installationBrian Smith/i);
    expect(container.textContent).not.toMatch(/REPAIR REQUESTJob type: RepairMaya Chen/i);

    act(() => jest.advanceTimersByTime(6500));

    expect(container.textContent).toMatch(/REPAIR REQUESTJob type: RepairMaya Chen/i);
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

    expect(container.textContent).toMatch(/Job typeNew installation/i);
    expect(container.textContent).toMatch(/CustomerBrian Smith/i);
    expect(container.textContent).toMatch(/Job address23 Robb Street, Hamilton/i);
  });

  test("connects the selected scenario to a clearly disclosed recording", () => {
    const phone = container.querySelector(".fcr-phone-shell");
    const audio = phone.querySelector(".tims-scenario-recording audio");
    expect(container.textContent).toMatch(/Recorded scenario call/i);
    expect(container.textContent).toMatch(/no real customer information/i);
    expect(audio).not.toBeNull();
    expect(audio.hasAttribute("src")).toBe(false);
    expect(audio.preload).toBe("none");
    expect(audio.dataset.publicDemoSource).toMatch(/audio\/tims-electrical\/new-installation\.mp3/i);
    expect(audio.play).not.toHaveBeenCalled();
    expect(phone.querySelector(".tims-voice-visualizer")).not.toBeNull();
    expect(phone.querySelector('button[aria-label="Play recorded scenario call"]')).not.toBeNull();
    expect(container.querySelector(".fcr-call-console > .tims-scenario-recording")).toBeNull();

    const repairButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Repair request",
    );
    act(() => repairButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toMatch(/Hear the repair request conversation/i);
    expect(container.querySelector(".tims-scenario-recording audio")?.dataset.publicDemoSource)
      .toMatch(/audio\/tims-electrical\/repair-request\.mp3/i);
    expect(container.querySelector(".tims-scenario-recording audio")?.hasAttribute("src")).toBe(false);
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
    const audio = container.querySelector('audio');
    Object.defineProperty(audio, 'duration', {configurable:true, value:85});
    act(() => audio.dispatchEvent(new Event('loadedmetadata')));
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

  const clickPlay = async () => act(async () => container.querySelector('.tims-recording-controls button')
    .dispatchEvent(new MouseEvent('click', {bubbles:true})));

  test('loads the MP3 only after Play and keeps seeking disabled until metadata exists', async () => {
    const audio = container.querySelector('audio');
    const range = container.querySelector('input[aria-label="Recorded call position"]');
    expect(range.disabled).toBe(true);
    await clickPlay();
    expect(audio.src).toMatch(/new-installation\.mp3$/);
    expect(audio.play).toHaveBeenCalledTimes(1);
    Object.defineProperty(audio, 'duration', {configurable:true, value:85});
    act(() => audio.dispatchEvent(new Event('loadedmetadata')));
    expect(range.disabled).toBe(false);
  });

  test('recovers from an unsupported MP3 using the original scenario WAV without a false alert', async () => {
    const audio = container.querySelector('audio');
    audio.play.mockRejectedValueOnce(new DOMException('unsupported','NotSupportedError')).mockResolvedValueOnce(undefined);
    await clickPlay();
    expect(audio.src).toMatch(/new-installation\.wav$/);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="Pause recorded scenario call"]')).not.toBeNull();
    expect(reportClientError).not.toHaveBeenCalled();
  });

  test('shows scenario-specific retry guidance after both formats fail and retries in one click', async () => {
    const audio = container.querySelector('audio');
    audio.play.mockRejectedValue(new DOMException('unsupported','NotSupportedError'));
    await clickPlay();
    expect(container.textContent).toMatch(/Retry recorded scenario call.*transcript below/);
    expect(container.textContent).not.toMatch(/Tap Hear Live Call/);
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(audio.pause).toHaveBeenCalled();
    audio.play.mockResolvedValue(undefined);
    await clickPlay();
    expect(audio.src).toMatch(/new-installation\.mp3$/);
    expect(container.querySelector('[aria-label="Pause recorded scenario call"]')).not.toBeNull();
  });

  test('a denied play stays retryable without reporting a broken recording', async () => {
    const audio = container.querySelector('audio');
    audio.play.mockRejectedValueOnce(new DOMException('blocked','NotAllowedError'));
    await clickPlay();
    expect(container.textContent).toMatch(/browser blocked playback.*Play recorded scenario call/);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(reportClientError).not.toHaveBeenCalled();
  });

  test('loading can be cancelled and a late rejection cannot restart the scenario', async () => {
    const audio = container.querySelector('audio');
    let reject;
    audio.play.mockImplementationOnce(() => new Promise((_yes,no) => {reject=no;}));
    await clickPlay();
    expect(container.querySelector('[aria-label="Cancel loading recorded scenario call"]')).not.toBeNull();
    await clickPlay();
    await act(async () => reject(new DOMException('cancelled','AbortError')));
    act(() => jest.advanceTimersByTime(31000));
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[aria-label="Play recorded scenario call"]')).not.toBeNull();
    expect(reportClientError).not.toHaveBeenCalled();
  });

  test('switching scenarios pauses and cancels the old player without preloading the next', async () => {
    const oldAudio = container.querySelector('audio');
    let reject;
    oldAudio.play.mockImplementationOnce(() => new Promise((_yes,no) => {reject=no;}));
    await clickPlay();
    const repair = [...container.querySelectorAll('[role="tab"]')].find(button => button.textContent.trim()==='Repair request');
    act(() => repair.dispatchEvent(new MouseEvent('click',{bubbles:true})));
    const next = container.querySelector('audio');
    expect(next).not.toBe(oldAudio);
    expect(oldAudio.pause).toHaveBeenCalled();
    expect(next.hasAttribute('src')).toBe(false);
    await act(async () => reject(new DOMException('old source','NotSupportedError')));
    act(() => jest.advanceTimersByTime(31000));
    expect(oldAudio.play).toHaveBeenCalledTimes(1);
    expect(reportClientError).not.toHaveBeenCalled();
  });
});

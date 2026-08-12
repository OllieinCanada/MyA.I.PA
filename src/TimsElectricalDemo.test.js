import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { TimsElectricalLiveDemo } from "./TimsElectricalDemo";

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
    expect(container.textContent).not.toMatch(/NEW INSTALLATION · Brian Smith/i);

    act(() => jest.advanceTimersByTime(4000));

    expect(container.textContent).toMatch(/NEW INSTALLATION · Brian Smith/i);
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
    expect(container.textContent).not.toMatch(/NEW INSTALLATION · Brian Smith/i);
    expect(container.textContent).not.toMatch(/REPAIR REQUEST · Maya Chen/i);

    act(() => jest.advanceTimersByTime(4000));

    expect(container.textContent).toMatch(/REPAIR REQUEST · Maya Chen/i);
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

  test("connects the selected scenario to a clearly disclosed recording", () => {
    const audio = container.querySelector(".tims-scenario-recording audio");
    expect(container.textContent).toMatch(/Recorded scenario call/i);
    expect(container.textContent).toMatch(/no real customer information/i);
    expect(audio).not.toBeNull();
    expect(audio.getAttribute("src")).toMatch(/audio\/tims-electrical\/new-installation\.wav/i);

    const repairButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent.trim() === "Repair request",
    );
    act(() => repairButton.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toMatch(/Hear the repair request conversation/i);
    expect(container.querySelector(".tims-scenario-recording audio")?.getAttribute("src"))
      .toMatch(/audio\/tims-electrical\/repair-request\.wav/i);
  });
});

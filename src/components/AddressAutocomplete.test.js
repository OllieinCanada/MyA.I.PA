import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import AddressAutocomplete from "./AddressAutocomplete";

const address = { addressComponents: [ ["street_number", "277"], ["route", "Mud Street"], ["locality", "Hamilton"], ["administrative_area_level_1", "ON"], ["postal_code", "L8J3Z6"], ["country", "CA"] ].map(([type, text]) => ({ types: [type], longText: text, shortText: text })) };
describe("address autocomplete", () => {
  let root, container, loadPlaces, fetchSuggestions, onSelect, fetchFields;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    onSelect = jest.fn(); fetchFields = jest.fn().mockResolvedValue({});
    fetchSuggestions = jest.fn().mockResolvedValue({ suggestions: [{ placePrediction: { placeId: "one", text: { toString: () => "277 Mud Street, Hamilton, ON, Canada" }, toPlace: () => ({ ...address, fetchFields }) } }] });
    loadPlaces = jest.fn().mockResolvedValue({ AutocompleteSessionToken: class {}, AutocompleteSuggestion: { fetchAutocompleteSuggestions: fetchSuggestions } });
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });
  function render(apiKey = "test-key") {
    function Harness() {
      const [value, setValue] = useState("");
      return <form onSubmit={(event) => event.preventDefault()}><AddressAutocomplete apiKey={apiKey} loadPlaces={loadPlaces} value={value}
        onChange={(event) => setValue(event.target.value)} onSelect={(data) => { onSelect(data); setValue(data.streetAddress); }}
        renderInput={(props) => <label>Street address<input value={value} {...props} /></label>} /></form>;
    }
    act(() => root.render(<Harness />));
    act(() => container.querySelector("input").focus());
  }
  async function type(value) {
    act(() => {
      const input = container.querySelector("input");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { jest.advanceTimersByTime(350); });
  }
  test("debounces Canadian-only requests; typing alone never selects an address", async () => {
    render(); await type("27"); expect(fetchSuggestions).not.toHaveBeenCalled();
    await type("277 Mud");
    expect(fetchSuggestions).toHaveBeenCalledWith(expect.objectContaining({ input: "277 Mud", includedRegionCodes: ["ca"], sessionToken: expect.any(Object) }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector('[role="listbox"]')).not.toBeNull();
    expect(container.textContent).toContain("Google Maps");
  });
  test("keyboard selection fills four fields and consumes only address components", async () => {
    render(); await type("277 Mud");
    act(() => container.querySelector("input").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await act(async () => container.querySelector("input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(onSelect).toHaveBeenCalledWith({ streetAddress: "277 Mud Street", city: "Hamilton", province: "ON", postalCode: "L8J 3Z6" });
    expect(fetchFields).toHaveBeenCalledWith({ fields: ["addressComponents"] });
    expect(container.querySelector("input").value).toBe("277 Mud Street");
    expect(container.querySelector('[role="listbox"]')).toBeNull();
  });
  test("missing key or failed provider leaves manual entry usable", async () => {
    render(""); await type("277 Mud Street"); expect(loadPlaces).not.toHaveBeenCalled();
    expect(container.querySelector("input").value).toBe("277 Mud Street");
    act(() => root.unmount()); root = createRoot(container);
    loadPlaces.mockRejectedValue(new Error("billing unavailable")); render(); await type("277 Mud");
    expect(container.textContent).toContain("Enter your address manually");
    expect(container.querySelector("input").value).toBe("277 Mud");
  });
  test("late lookup results cannot replace a newer query", async () => {
    let resolveOld;
    fetchSuggestions.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    render(); await type("277 Old"); await type("277 New");
    await act(async () => resolveOld({ suggestions: [{ placePrediction: { text: { toString: () => "Stale address" } } }] }));
    expect(container.textContent).not.toContain("Stale address");
  });
  test("late selected-address fetch cannot overwrite an edited address", async () => {
    let resolveDetails;
    fetchFields.mockImplementationOnce(() => new Promise((resolve) => { resolveDetails = resolve; }));
    render(); await type("277 Mud");
    act(() => container.querySelector('[role="option"]').click());
    await type("Different address");
    await act(async () => resolveDetails({}));
    expect(onSelect).not.toHaveBeenCalled();
    expect(container.querySelector("input").value).toBe("Different address");
  });
});

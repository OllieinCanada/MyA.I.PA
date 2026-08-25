import React, { act } from "react";
import { createRoot } from "react-dom/client";
import Signup from "./Signup";

jest.mock("@vapi-ai/web", () => jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  off: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
})));

describe("intuitive signup presentation", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.matchMedia = jest.fn().mockReturnValue({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    });
    window.scrollTo = jest.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("shows one progress route and one question", () => {
    act(() => root.render(<Signup />));

    expect(container.querySelectorAll(".signup-visible-progress")).toHaveLength(1);
    expect(container.querySelector(".signup-macro-stepper")).toBeNull();
    expect(container.querySelector(".signup-home-row a").getAttribute("href")).toBe("#/");
    expect(container.textContent).toMatch(/Step 1 of 8/i);
    expect(container.textContent).toMatch(/Choose your trade/i);
    expect(container.querySelectorAll(".signup-trade-grid button")).toHaveLength(6);
  });
});

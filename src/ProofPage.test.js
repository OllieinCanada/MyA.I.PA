import React, { act } from "react";
import { createRoot } from "react-dom/client";
import ProofPage from "./ProofPage";

describe("Employer proof page", () => {
  let container;
  let root;

  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ProofPage />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("presents the verified evidence and honest prototype status", () => {
    expect(container.textContent).toMatch(/155/);
    expect(container.textContent).toMatch(/20/);
    expect(container.textContent).toMatch(/working prototype/i);
    expect(container.textContent).toMatch(/demonstration data/i);
  });

  test("includes the recorded demo and employer contact paths", () => {
    expect(container.querySelector("audio")?.getAttribute("src")).toMatch(/tims-electrical-2\.wav/);
    expect(container.querySelector('a[href^="mailto:hello@myaipa.com"]')).not.toBeNull();
    expect(container.querySelector('a[href*="linkedin.com/in/oliver-slapinski"]')).not.toBeNull();
  });
});

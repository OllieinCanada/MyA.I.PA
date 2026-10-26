import React, { act } from "react";
import { createRoot } from "react-dom/client";
import BusinessDetailsEditor from "./BusinessDetailsEditor";

describe("safe existing-receptionist content editor", () => {
  let container, root, originalFetch, onSaved, onCancel;
  const details = { businessName: "Synthetic Electric", services: "Repairs", serviceAreas: "Niagara", businessNotes: "Open weekdays." };
  const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const click = async text => act(async () => [...container.querySelectorAll("button")].find(item => item.textContent === text).click());
  const edit = async (label, value) => act(async () => {
    const node = [...container.querySelectorAll("label")].find(item => item.firstChild?.textContent === label).querySelector("input,textarea");
    Object.getOwnPropertyDescriptor(node.tagName === "INPUT" ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype, "value").set.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true; originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue(response({ ok: true, status: "ready", revision: 2, details }));
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    onSaved = jest.fn(); onCancel = jest.fn();
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); global.fetch = originalFetch; jest.restoreAllMocks(); });
  const mount = async () => act(async () => root.render(<BusinessDetailsEditor token="signed-setup" onSaved={onSaved} onCancel={onCancel} />));

  test("loads with both owner credentials and signed setup, matching the backend field limits", async () => {
    await mount();
    expect(global.fetch.mock.calls[0][1]).toMatchObject({ credentials: "include", headers: { Authorization: "Forwarding signed-setup" } });
    expect([...container.querySelectorAll("input,textarea")].map(item => item.maxLength)).toEqual([140, 4000, 2000, 4000]);
    expect(container.querySelector("input").value).toBe(details.businessName);
  });

  test("only a verified published response returns to practice, retaining assigned resources", async () => {
    await mount(); await edit("Services", "Lighting repairs");
    global.fetch.mockResolvedValueOnce(response({ ok: true, status: "published", revision: 3, details: { ...details, services: "Lighting repairs" } }));
    await click("Save changes and return to test");
    const [url, options] = global.fetch.mock.calls.at(-1);
    expect(url).toMatch(/business-details$/);
    expect(options).toMatchObject({ method: "PATCH", credentials: "include", headers: { Authorization: "Forwarding signed-setup", "X-MyAIPA-Editor": "1" } });
    expect(JSON.parse(options.body)).toMatchObject({ expectedRevision: 2, details: { ...details, services: "Lighting repairs" } });
    expect(JSON.parse(options.body).requestId.length).toBeGreaterThan(8);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls.some(([target]) => /provision|signup\/submit/.test(target))).toBe(false);
  });

  test("uncertain failure preserves the exact draft/request ID and locks edits until retry resolves", async () => {
    await mount(); await edit("Services", "Pending correction");
    global.fetch.mockRejectedValueOnce(new Error("Connection lost after saving."));
    await click("Save changes and return to test");
    const body = global.fetch.mock.calls.at(-1)[1].body;
    expect(onSaved).not.toHaveBeenCalled();
    expect(container.querySelector("fieldset").disabled).toBe(true);
    global.fetch.mockResolvedValueOnce(response({ ok: true, status: "published", revision: 3, details }));
    await click("Retry this save");
    expect(global.fetch.mock.calls.at(-1)[1].body).toBe(body);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("refresh recovery retries the backend pending envelope, never a replacement request", async () => {
    const pendingSave = { requestId: "prior-save-123456", expectedRevision: 2, details: { ...details, businessNotes: "Pending amended notes." } };
    global.fetch.mockResolvedValueOnce(response({ ok: true, status: "needs_attention", revision: 2, details, pendingSave }));
    await mount();
    expect(container.querySelectorAll("textarea")[2].value).toBe(pendingSave.details.businessNotes);
    expect(container.querySelector("fieldset").disabled).toBe(true);
    global.fetch.mockResolvedValueOnce(response({ ok: true, status: "published", revision: 3, details: pendingSave.details }));
    await click("Retry this save");
    expect(JSON.parse(global.fetch.mock.calls.at(-1)[1].body)).toEqual(pendingSave);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("attention without a recoverable pending request cannot create a new draft save", async () => {
    global.fetch.mockResolvedValueOnce(response({ ok: true, status: "needs_attention", revision: 2, details }));
    await mount();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Call support before starting another update");
    expect(onSaved).not.toHaveBeenCalled();
  });

  test("owner OTP is requested only after a user explicitly submits the inline sign-in form", async () => {
    global.fetch.mockResolvedValueOnce(response({ error: "Sign in first." }, 401));
    await mount();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await edit("Signup email", "owner@example.invalid"); await edit("Owner or business phone", "9055550199");
    global.fetch.mockResolvedValueOnce(response({ codeSent: true, destination: "•••• 0199" }, 202));
    await click("Text me a sign-in code");
    expect(global.fetch.mock.calls.at(-1)[0]).toMatch(/request-code$/);
    await edit("One-time sign-in code", "123456");
    global.fetch.mockResolvedValueOnce(response({ dashboard: {} })).mockResolvedValueOnce(response({ ok: true, status: "ready", revision: 2, details }));
    await click("Verify and return to setup");
    expect(container.querySelector("input").value).toBe(details.businessName);
    expect(onSaved).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem("owner@example.invalid")).toBeNull();
  });
});

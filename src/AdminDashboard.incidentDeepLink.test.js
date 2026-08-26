import fs from "fs";
import path from "path";
import {
  getIncidentSnapshotRows,
  parseAdminIncidentLink,
} from "./AdminDashboard";

test("an opaque incident link opens the attention tab and rejects unsafe identifiers", () => {
  expect(parseAdminIncidentLink("#/admin?tab=signups&incident=ABCDEF1234567890ABCDEF12")).toEqual({
    tab: "attention",
    incidentId: "abcdef1234567890abcdef12",
  });
  expect(parseAdminIncidentLink("#/admin?tab=support&incident=owner@example.com")).toEqual({
    tab: "support",
    incidentId: "",
  });
});

test("incident snapshot fields are converted into concise display rows", () => {
  expect(getIncidentSnapshotRows({
    incidentSnapshot: {
      reason: { summary: "Provisioning returned no completion proof." },
      impact: ["Signup is held", "No number is live"],
      lastCheckpoint: { completed: "Email verification completed" },
      nextAction: { description: "Review before attempting recovery" },
    },
  })).toEqual([
    ["Reason", "Provisioning returned no completion proof."],
    ["Impact", "Signup is held · No number is live"],
    ["Last checkpoint", "Email verification completed"],
    ["Next action", "Review before attempting recovery"],
  ]);
});

test("runtime incident context is shown alongside the recovery brief", () => {
  expect(getIncidentSnapshotRows({
    incident: {
      reason: "The API returned an error.",
      impact: "Signup stopped.",
      lastCheckpoint: "Request reached the API.",
      nextAction: "Inspect the incident.",
    },
    snapshot: {
      Workflow: "customer signup",
      Method: "POST",
      Route: "/api/signup",
      Status: "500",
    },
  })).toEqual([
    ["Reason", "The API returned an error."],
    ["Impact", "Signup stopped."],
    ["Last checkpoint", "Request reached the API."],
    ["Next action", "Inspect the incident."],
    ["Workflow", "customer signup"],
    ["Method", "POST"],
    ["Route", "/api/signup"],
    ["Status", "500"],
  ]);
});

test("the requested incident is focused and visibly identified after loading", () => {
  const source = fs.readFileSync(path.join(__dirname, "AdminDashboard.js"), "utf8");
  expect(source).toMatch(/admin-incident-\$\{incidentId\}/);
  expect(source).toMatch(/scrollIntoView/);
  expect(source).toMatch(/element\.focus/);
  expect(source).toMatch(/aria-current=\{isRequestedIncident/);
  expect(source).toMatch(/ring-4 ring-sky-300\/40/);
});

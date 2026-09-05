const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "TradePages.js"), "utf8");

test("every generated trade flyer uses the standard useful-lead contract", () => {
  for (const phrase of [
    "THE JOB DETAILS YOU NEED",
    "KEEP YOUR EXISTING BUSINESS NUMBER",
    "CALLER",
    "PHONE",
    "WORK REQUESTED",
    "ADDRESS",
    "PREFERRED START",
    "BEST CALLBACK",
    "URGENCY",
    "preference only",
  ]) {
    assert.match(source, new RegExp(phrase, "i"));
  }
  assert.match(source, /asks only for missing information/i);
  assert.match(source, /reads the details back once/i);
  assert.match(source, /not a booked appointment/i);
});

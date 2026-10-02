const test = require("node:test");
const assert = require("node:assert/strict");
const { isGoogleApiUrl } = require("../scripts/test-address-autocomplete");

test("Google diagnostics accept only HTTPS Google API domains", () => {
  for (const url of ["https://googleapis.com/", "https://maps.googleapis.com/maps/api/js", "https://places.googleapis.com/"]) {
    assert.equal(isGoogleApiUrl(url), true, url);
  }
  for (const url of ["https://evilgoogleapis.com/", "https://googleapis.com.evil.example/", "https://googleapis.com@evil.example/", "http://maps.googleapis.com/", "not a URL"]) {
    assert.equal(isGoogleApiUrl(url), false, url);
  }
});

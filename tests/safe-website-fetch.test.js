const assert = require("node:assert/strict");
const { test } = require("node:test");
const { assertPublicWebsiteUrl, fetchPublicWebsite, isBlockedIp } = require("../server/safeWebsiteFetch");

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("private, loopback, link-local, and reserved IP addresses are blocked", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.169.254", "::1", "fc00::1", "fe80::1"]) {
    assert.equal(isBlockedIp(address), true, `${address} should be blocked`);
  }
  assert.equal(isBlockedIp("8.8.8.8"), false);
  assert.equal(isBlockedIp("2606:4700:4700::1111"), false);
});

test("website URLs reject local hosts, credentials, unsafe ports, and private DNS answers", async () => {
  await assert.rejects(assertPublicWebsiteUrl("http://localhost/admin", { lookup: publicLookup }), /blocked host/i);
  await assert.rejects(assertPublicWebsiteUrl("http://user:pass@example.com", { lookup: publicLookup }), /credentials/i);
  await assert.rejects(assertPublicWebsiteUrl("https://example.com:8443", { lookup: publicLookup }), /blocked port/i);
  await assert.rejects(
    assertPublicWebsiteUrl("https://example.com", { lookup: async () => [{ address: "10.0.0.5", family: 4 }] }),
    /private or reserved/i
  );
});

test("public HTTP and HTTPS websites pass validation", async () => {
  const http = await assertPublicWebsiteUrl("http://example.com", { lookup: publicLookup });
  const https = await assertPublicWebsiteUrl("https://example.com/path", { lookup: publicLookup });
  assert.equal(http.protocol, "http:");
  assert.equal(https.protocol, "https:");
});

test("redirect destinations are revalidated before being fetched", async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    return {
      status: 302,
      headers: { get: (name) => (name.toLowerCase() === "location" ? "http://127.0.0.1/secrets" : null) },
    };
  };

  await assert.rejects(
    fetchPublicWebsite("https://example.com", {}, { fetchImpl, lookup: publicLookup }),
    /private or reserved/i
  );
  assert.deepEqual(fetched, ["https://example.com/"]);
});

test("safe redirects can complete", async () => {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (fetched.length === 1) {
      return {
        status: 301,
        headers: { get: () => "https://www.example.com/home" },
      };
    }
    return { status: 200, headers: { get: () => "text/html" } };
  };

  const response = await fetchPublicWebsite("https://example.com", {}, { fetchImpl, lookup: publicLookup });
  assert.equal(response.status, 200);
  assert.deepEqual(fetched, ["https://example.com/", "https://www.example.com/home"]);
});

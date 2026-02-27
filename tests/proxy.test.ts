import { test, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { loadConfig, setCategoryMode, addAllowedEndpoint, removeAllowedEndpoint } from "../src/config";
import { PermissionQueue } from "../src/queue";

// We test proxy logic indirectly through config + queue since the proxy
// is a Bun.serve that's harder to unit test without spinning up ports.
// Integration testing happens via docker compose.

beforeAll(async () => {
  await loadConfig();
});

test("allowed endpoint bypasses queue", () => {
  const { isEndpointAllowed } = require("../src/config");
  expect(isEndpointAllowed("api.anthropic.com")).toBe(true);
});

test("non-allowed endpoint would be queued", () => {
  const { isEndpointAllowed, getCategoryMode } = require("../src/config");
  expect(isEndpointAllowed("evil.com")).toBe(false);
  expect(getCategoryMode("network")).toBe("approve-each");
  // In approve-each mode, a non-allowed host creates a queue entry
});

test("allow-all mode skips queue for all hosts", () => {
  setCategoryMode("network", "allow-all");
  const { getCategoryMode } = require("../src/config");
  expect(getCategoryMode("network")).toBe("allow-all");
  setCategoryMode("network", "approve-each");
});

test("deny-all mode blocks all non-allowed hosts", () => {
  setCategoryMode("network", "deny-all");
  const { getCategoryMode } = require("../src/config");
  expect(getCategoryMode("network")).toBe("deny-all");
  setCategoryMode("network", "approve-each");
});

test("queue request for network creates proper entry", () => {
  const q = new PermissionQueue();
  const { id } = q.request(
    "network",
    "CONNECT evil.com:443",
    "HTTPS connection to evil.com:443",
    "Agent requested tunnel"
  );

  const req = q.get(id);
  expect(req).toBeDefined();
  expect(req!.category).toBe("network");
  expect(req!.action).toBe("CONNECT evil.com:443");
  expect(req!.status).toBe("pending");
});

test("approved network request resolves true", async () => {
  const q = new PermissionQueue();
  const { id, promise } = q.request(
    "network",
    "GET http://example.com/api",
    "HTTP request to example.com"
  );
  q.approve(id);
  expect(await promise).toBe(true);
});

test("denied network request resolves false", async () => {
  const q = new PermissionQueue();
  const { id, promise } = q.request(
    "network",
    "GET http://malware.com/payload",
    "HTTP request to malware.com"
  );
  q.deny(id);
  expect(await promise).toBe(false);
});

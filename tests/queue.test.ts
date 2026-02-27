import { test, expect, beforeEach } from "bun:test";
import { PermissionQueue } from "../src/queue";

let q: PermissionQueue;

beforeEach(() => {
  q = new PermissionQueue();
});

test("request creates a pending entry", () => {
  const { id } = q.request("network", "GET https://example.com", "HTTP request");
  const req = q.get(id);
  expect(req).toBeDefined();
  expect(req!.status).toBe("pending");
  expect(req!.category).toBe("network");
  expect(req!.action).toBe("GET https://example.com");
});

test("approve resolves the promise with true", async () => {
  const { id, promise } = q.request("network", "GET https://example.com", "test");
  q.approve(id, "cli");
  const result = await promise;
  expect(result).toBe(true);
  expect(q.get(id)!.status).toBe("approved");
  expect(q.get(id)!.resolvedBy).toBe("cli");
});

test("deny resolves the promise with false", async () => {
  const { id, promise } = q.request("network", "GET https://example.com", "test");
  q.deny(id, "web");
  const result = await promise;
  expect(result).toBe(false);
  expect(q.get(id)!.status).toBe("denied");
});

test("pending() returns only pending requests", () => {
  const { id: id1 } = q.request("network", "a", "test");
  q.request("filesystem", "b", "test");
  q.approve(id1);

  const pending = q.pending();
  expect(pending.length).toBe(1);
  expect(pending[0].category).toBe("filesystem");
});

test("recent() returns all requests", () => {
  q.request("network", "a", "test");
  q.request("filesystem", "b", "test");
  q.request("git", "c", "test");

  const recent = q.recent();
  expect(recent.length).toBe(3);
  const actions = recent.map((r) => r.action).sort();
  expect(actions).toEqual(["a", "b", "c"]);
});

test("bulkResolve approves all pending in a category", async () => {
  const { promise: p1 } = q.request("network", "a", "test");
  const { promise: p2 } = q.request("network", "b", "test");
  q.request("filesystem", "c", "test");

  const count = q.bulkResolve("network", "approved", "web");
  expect(count).toBe(2);
  expect(await p1).toBe(true);
  expect(await p2).toBe(true);
  expect(q.pending().length).toBe(1); // filesystem one remains
});

test("resolve emits events", async () => {
  const events: string[] = [];
  q.on("request", (req) => events.push(`request:${req.id}`));
  q.on("resolve", (req) => events.push(`resolve:${req.id}:${req.status}`));

  const { id } = q.request("network", "test", "test");
  q.approve(id);

  expect(events).toEqual([`request:${id}`, `resolve:${id}:approved`]);
});

test("resolve on non-existent id returns false", () => {
  expect(q.approve("nonexistent")).toBe(false);
});

test("resolve on already resolved request returns false", () => {
  const { id } = q.request("network", "test", "test");
  q.approve(id);
  expect(q.approve(id)).toBe(false);
});

test("poll returns the request", () => {
  const { id } = q.request("network", "test", "test");
  const polled = q.poll(id);
  expect(polled).toBeDefined();
  expect(polled!.id).toBe(id);
});

test("IDs are sequential", () => {
  const { id: id1 } = q.request("network", "a", "test");
  const { id: id2 } = q.request("network", "b", "test");
  expect(id1).toBe("req-0");
  expect(id2).toBe("req-1");
});

import { test, expect, beforeEach, afterEach } from "bun:test";
import { appendAudit, readAuditLog, type AuditEntry } from "../src/audit";
import { rm, mkdir } from "fs/promises";

const DATA_DIR = new URL("../data/", import.meta.url).pathname;
const AUDIT_FILE = DATA_DIR + "audit.log";

beforeEach(async () => {
  await mkdir(DATA_DIR, { recursive: true });
  // Clean audit log for each test
  try { await rm(AUDIT_FILE); } catch {}
});

afterEach(async () => {
  try { await rm(AUDIT_FILE); } catch {}
});

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    timestamp: Date.now(),
    id: "req-0",
    category: "network",
    action: "CONNECT example.com:443",
    decision: "approved",
    resolvedBy: "web",
    durationMs: 1234,
    metadata: { extra: "data" },
    ...overrides,
  };
}

test("write + read round-trip", async () => {
  const entry = makeEntry();
  await appendAudit(entry);

  const entries = await readAuditLog();
  expect(entries.length).toBe(1);
  expect(entries[0].id).toBe("req-0");
  expect(entries[0].category).toBe("network");
  expect(entries[0].decision).toBe("approved");
});

test("empty file returns empty array", async () => {
  const entries = await readAuditLog();
  expect(entries).toEqual([]);
});

test("limit parameter works", async () => {
  await appendAudit(makeEntry({ id: "req-1", timestamp: 1000 }));
  await appendAudit(makeEntry({ id: "req-2", timestamp: 2000 }));
  await appendAudit(makeEntry({ id: "req-3", timestamp: 3000 }));

  const entries = await readAuditLog(2);
  expect(entries.length).toBe(2);
  // Most recent first (reversed order)
  expect(entries[0].id).toBe("req-3");
  expect(entries[1].id).toBe("req-2");
});

test("all fields persisted", async () => {
  const entry = makeEntry({
    id: "req-42",
    category: "exec",
    action: "bun test",
    decision: "denied",
    resolvedBy: "cli",
    durationMs: 5678,
    metadata: { command: "bun test", cwd: "/app" },
  });
  await appendAudit(entry);

  const entries = await readAuditLog();
  expect(entries.length).toBe(1);
  const e = entries[0];
  expect(e.id).toBe("req-42");
  expect(e.category).toBe("exec");
  expect(e.action).toBe("bun test");
  expect(e.decision).toBe("denied");
  expect(e.resolvedBy).toBe("cli");
  expect(e.durationMs).toBe(5678);
  expect(e.metadata).toEqual({ command: "bun test", cwd: "/app" });
});

test("multiple entries append correctly", async () => {
  await appendAudit(makeEntry({ id: "req-1" }));
  await appendAudit(makeEntry({ id: "req-2" }));
  await appendAudit(makeEntry({ id: "req-3" }));

  const entries = await readAuditLog();
  expect(entries.length).toBe(3);
});

import { describe, test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import type { Subprocess } from "bun";

setDefaultTimeout(15_000);

const PORT = 3700 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
let server: Subprocess;

async function waitForReady(url: string, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`Server not ready after ${timeout}ms`);
}

beforeAll(async () => {
  server = Bun.spawn(["bun", "run", "src/server.ts"], {
    env: {
      ...process.env,
      SERVER_PORT: String(PORT),
      PROXY_INLINE: "false",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  await waitForReady(`${BASE}/api/config`);
});

afterAll(() => {
  server.kill();
});

// --- Queue lifecycle ---

describe("queue lifecycle", () => {
  test("submit → list pending → approve → verify resolved", async () => {
    // Submit
    const submitRes = await fetch(`${BASE}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "network",
        action: "CONNECT test.example.com:443",
        description: "Test request",
        reason: "e2e test",
      }),
    });
    expect(submitRes.status).toBe(201);
    const { id } = await submitRes.json() as { id: string };
    expect(id).toBeTruthy();

    // List pending
    const listRes = await fetch(`${BASE}/api/queue`);
    const { pending } = await listRes.json() as { pending: any[] };
    expect(pending.some((r: any) => r.id === id)).toBe(true);

    // Approve
    const approveRes = await fetch(`${BASE}/api/queue/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "web" }),
    });
    expect(approveRes.status).toBe(200);
    const { ok } = await approveRes.json() as { ok: boolean };
    expect(ok).toBe(true);

    // Verify resolved
    const afterRes = await fetch(`${BASE}/api/queue`);
    const after = await afterRes.json() as { pending: any[]; recent: any[] };
    const resolved = after.recent.find((r: any) => r.id === id);
    expect(resolved).toBeDefined();
    expect(resolved.status).toBe("approved");
  });
});

// --- Deny flow ---

describe("deny flow", () => {
  test("submit → deny → verify", async () => {
    const submitRes = await fetch(`${BASE}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "network",
        action: "CONNECT evil.com:443",
        description: "Test deny",
      }),
    });
    const { id } = await submitRes.json() as { id: string };

    const denyRes = await fetch(`${BASE}/api/queue/${id}/deny`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "web" }),
    });
    expect(denyRes.status).toBe(200);

    const afterRes = await fetch(`${BASE}/api/queue`);
    const after = await afterRes.json() as { recent: any[] };
    const denied = after.recent.find((r: any) => r.id === id);
    expect(denied).toBeDefined();
    expect(denied.status).toBe("denied");
  });
});

// --- Rules CRUD ---

describe("rules CRUD", () => {
  test("add → list → remove", async () => {
    // Add
    const addRes = await fetch(`${BASE}/api/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allow", rule: "network(*.e2e-test.com)" }),
    });
    expect(addRes.status).toBe(200);
    const addBody = await addRes.json() as { added: boolean; rules: any };
    expect(addBody.added).toBe(true);

    // List
    const listRes = await fetch(`${BASE}/api/rules`);
    const rules = await listRes.json() as { allow: string[]; deny: string[] };
    expect(rules.allow).toContain("network(*.e2e-test.com)");

    // Remove
    const rmRes = await fetch(`${BASE}/api/rules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allow", rule: "network(*.e2e-test.com)" }),
    });
    expect(rmRes.status).toBe(200);
    const rmBody = await rmRes.json() as { removed: boolean };
    expect(rmBody.removed).toBe(true);

    // Verify gone
    const afterRes = await fetch(`${BASE}/api/rules`);
    const afterRules = await afterRes.json() as { allow: string[] };
    expect(afterRules.allow).not.toContain("network(*.e2e-test.com)");
  });
});

// --- Always allow ---

describe("always allow", () => {
  test("approve with alwaysAllow flag creates a rule", async () => {
    const submitRes = await fetch(`${BASE}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "network",
        action: "CONNECT always.e2e-test.com:443",
        description: "Test always-allow",
      }),
    });
    const { id } = await submitRes.json() as { id: string };

    await fetch(`${BASE}/api/queue/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "web", alwaysAllow: true }),
    });

    const rulesRes = await fetch(`${BASE}/api/rules`);
    const rules = await rulesRes.json() as { allow: string[] };
    expect(rules.allow.some((r: string) => r.includes("e2e-test.com"))).toBe(true);

    // Clean up
    for (const rule of rules.allow.filter((r: string) => r.includes("e2e-test.com"))) {
      await fetch(`${BASE}/api/rules`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "allow", rule }),
      });
    }
  });
});

// --- Exec endpoint ---

describe("exec endpoint", () => {
  test("submit → check status", async () => {
    const submitRes = await fetch(`${BASE}/api/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "echo hello", reason: "e2e test" }),
    });
    expect(submitRes.status).toBe(201);
    const { id } = await submitRes.json() as { id: string };
    expect(id).toBeTruthy();

    const statusRes = await fetch(`${BASE}/api/exec/${id}`);
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json() as { id: string; status: string };
    expect(status.id).toBe(id);
  });
});

// --- Packages endpoint ---

describe("packages endpoint", () => {
  test("submit → check status", async () => {
    const submitRes = await fetch(`${BASE}/api/packages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manager: "bun", packages: ["test-e2e-pkg"], reason: "e2e test" }),
    });
    expect(submitRes.status).toBe(201);
    const { id } = await submitRes.json() as { id: string };
    expect(id).toBeTruthy();

    const statusRes = await fetch(`${BASE}/api/packages/${id}`);
    expect(statusRes.status).toBe(200);
    const status = await statusRes.json() as { id: string; status: string };
    expect(status.id).toBe(id);
  });
});

// --- Status endpoint ---

describe("status endpoint", () => {
  test("returns uptime info", async () => {
    const res = await fetch(`${BASE}/api/status`);
    expect(res.status).toBe(200);
    const status = await res.json() as any;
    expect(status.startedAt).toBeNumber();
    expect(status.uptime).toBeString();
    // No MAX_UPTIME set in e2e, so remaining should be null
    expect(status.maxUptimeMs).toBeNull();
    expect(status.remainingMs).toBeNull();
  });
});

// --- Config endpoint ---

describe("config endpoint", () => {
  test("get config returns valid structure", async () => {
    const res = await fetch(`${BASE}/api/config`);
    expect(res.status).toBe(200);
    const config = await res.json() as any;
    expect(config.allowedEndpoints).toBeArray();
    expect(config.categories).toBeDefined();
    expect(config.categories.network).toBeDefined();
    expect(config.categories.exec).toBeDefined();
    expect(config.rules).toBeDefined();
  });
});

// --- WebSocket ---

describe("websocket", () => {
  test("connect → receive init message with pending/config/rules", async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws`);

    const message = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WS timeout")), 5000);
      ws.onmessage = (event) => {
        clearTimeout(timeout);
        resolve(JSON.parse(String(event.data)));
      };
      ws.onerror = (err) => {
        clearTimeout(timeout);
        reject(err);
      };
    });

    expect(message.type).toBe("init");
    expect(message.data.pending).toBeArray();
    expect(message.data.config).toBeDefined();
    expect(message.data.rules).toBeDefined();

    ws.close();
  });
});

// --- Audit log ---

describe("audit log", () => {
  test("submit → approve → check /api/audit has the entry", async () => {
    const submitRes = await fetch(`${BASE}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: "sandbox",
        action: "audit-e2e-test",
        description: "Testing audit log",
      }),
    });
    const { id } = await submitRes.json() as { id: string };

    await fetch(`${BASE}/api/queue/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolvedBy: "web" }),
    });

    // Give the fire-and-forget audit write a moment
    await Bun.sleep(200);

    const auditRes = await fetch(`${BASE}/api/audit?limit=50`);
    expect(auditRes.status).toBe(200);
    const entries = await auditRes.json() as any[];
    const match = entries.find((e: any) => e.id === id);
    expect(match).toBeDefined();
    expect(match.decision).toBe("approved");
    expect(match.category).toBe("sandbox");
  });
});

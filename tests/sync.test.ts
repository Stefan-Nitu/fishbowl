import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { applyFilesystemRequest } from "../src/sync";
import { PermissionQueue } from "../src/queue";
import type { PermissionRequest } from "../src/types";
import { rm, mkdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DIR = join(tmpdir(), `fishbowl-sync-test-${process.pid}`);
const TEST_FILE = `${TEST_DIR}/target.txt`;

// Override WORKSPACE so applyFilesystemRequest writes to our temp dir
process.env.WORKSPACE = TEST_DIR;

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: "test-1",
    category: "filesystem",
    action: "Write target.txt",
    description: "test",
    status: "pending",
    createdAt: Date.now(),
    metadata: {},
    ...overrides,
  };
}

describe("applyFilesystemRequest", () => {
  beforeEach(async () => {
    await mkdir(TEST_DIR, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(TEST_DIR, { recursive: true });
    } catch {}
  });

  test("Write: creates file with writeContent", async () => {
    const req = makeRequest({
      metadata: {
        toolName: "Write",
        targetFile: "target.txt",
        writeContent: "hello from test",
      },
    });

    const result = await applyFilesystemRequest(req);
    expect(result.ok).toBe(true);

    const content = await Bun.file(TEST_FILE).text();
    expect(content).toBe("hello from test");
  });

  test("Write: fails without writeContent", async () => {
    const req = makeRequest({
      metadata: {
        toolName: "Write",
        targetFile: "target.txt",
      },
    });

    const result = await applyFilesystemRequest(req);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("writeContent");
  });

  test("Edit: replaces old_string with new_string", async () => {
    await Bun.write(TEST_FILE, "const x = 1;\nconst y = 2;\n");

    const req = makeRequest({
      metadata: {
        toolName: "Edit",
        targetFile: "target.txt",
        editContext: { old_string: "const x = 1;", new_string: "const x = 99;" },
      },
    });

    const result = await applyFilesystemRequest(req);
    expect(result.ok).toBe(true);

    const content = await Bun.file(TEST_FILE).text();
    expect(content).toBe("const x = 99;\nconst y = 2;\n");
  });

  test("Edit: stale when old_string not found", async () => {
    await Bun.write(TEST_FILE, "totally different content\n");

    const req = makeRequest({
      metadata: {
        toolName: "Edit",
        targetFile: "target.txt",
        editContext: { old_string: "const x = 1;", new_string: "const x = 99;" },
      },
    });

    const result = await applyFilesystemRequest(req);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("stale");
  });

  test("Edit: stale when file does not exist", async () => {
    const req = makeRequest({
      metadata: {
        toolName: "Edit",
        targetFile: "nonexistent.txt",
        editContext: { old_string: "x", new_string: "y" },
      },
    });

    const result = await applyFilesystemRequest(req);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("stale");
  });

  test("fails without toolName", async () => {
    const req = makeRequest({
      metadata: { targetFile: "foo.txt" },
    });

    const result = await applyFilesystemRequest(req);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("toolName");
  });
});

describe("superseding", () => {
  test("second request for same targetFile auto-denies the first", async () => {
    const queue = new PermissionQueue();

    const { id: id1, promise: p1 } = queue.request(
      "filesystem",
      "Write foo.ts",
      "first write",
      undefined,
      { toolName: "Write", targetFile: "src/foo.ts", writeContent: "v1" }
    );

    const { id: id2 } = queue.request(
      "filesystem",
      "Write foo.ts",
      "second write",
      undefined,
      { toolName: "Write", targetFile: "src/foo.ts", writeContent: "v2" }
    );

    // First should be auto-denied
    const firstApproved = await p1;
    expect(firstApproved).toBe(false);

    const first = queue.get(id1);
    expect(first?.status).toBe("denied");
    expect(first?.resolvedBy).toBe("auto");

    // Second should still be pending
    const second = queue.get(id2);
    expect(second?.status).toBe("pending");
  });

  test("different targetFile does not supersede", () => {
    const queue = new PermissionQueue();

    queue.request(
      "filesystem",
      "Write foo.ts",
      "first write",
      undefined,
      { toolName: "Write", targetFile: "src/foo.ts", writeContent: "v1" }
    );

    queue.request(
      "filesystem",
      "Write bar.ts",
      "second write",
      undefined,
      { toolName: "Write", targetFile: "src/bar.ts", writeContent: "v2" }
    );

    const pending = queue.pending();
    expect(pending.length).toBe(2);
  });

  test("non-filesystem requests are not superseded", () => {
    const queue = new PermissionQueue();

    queue.request("exec", "run test", "first exec");
    queue.request("exec", "run test", "second exec");

    const pending = queue.pending();
    expect(pending.length).toBe(2);
  });
});

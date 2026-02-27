import { test, expect, beforeEach } from "bun:test";
import { PermissionQueue } from "../src/queue";
import { submitExec, getExecRequest } from "../src/exec";
import { loadConfig, getCategoryMode, setCategoryMode } from "../src/config";

beforeEach(async () => {
  await loadConfig();
});

test("exec request goes through queue", async () => {
  const execReq = await submitExec("echo hello", undefined, "test");
  expect(execReq.id).toMatch(/^req-/);
  expect(execReq.status).toBe("pending");
  expect(execReq.command).toBe("echo hello");
});

test("exec category refuses allow-all mode override", () => {
  setCategoryMode("exec", "allow-all");
  expect(getCategoryMode("exec")).toBe("approve-each");

  setCategoryMode("exec", "deny-all");
  expect(getCategoryMode("exec")).toBe("approve-each");

  setCategoryMode("exec", "approve-bulk");
  expect(getCategoryMode("exec")).toBe("approve-each");
});

test("exec category always returns approve-each", () => {
  expect(getCategoryMode("exec")).toBe("approve-each");
});

test("getExecRequest returns submitted request", async () => {
  const execReq = await submitExec("ls -la", "/tmp", "list files");
  const found = getExecRequest(execReq.id);
  expect(found).toBeDefined();
  expect(found!.command).toBe("ls -la");
  expect(found!.cwd).toBe("/tmp");
  expect(found!.reason).toBe("list files");
});

test("getExecRequest returns undefined for unknown id", () => {
  expect(getExecRequest("req-nonexistent")).toBeUndefined();
});

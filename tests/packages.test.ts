import { test, expect, beforeEach } from "bun:test";
import { parsePackageCommand, buildCommand, getPackageRequest, submitPackageRequest } from "../src/packages";
import { loadConfig, getCategoryMode, setCategoryMode, addRule, removeRule } from "../src/config";
import { evaluateRules } from "../src/rules";
import type { RuleSet } from "../src/types";

beforeEach(async () => {
  await loadConfig();
});

// --- parsePackageCommand ---

test("parsePackageCommand: bun add", () => {
  const r = parsePackageCommand("bun add react react-dom");
  expect(r).toEqual({ manager: "bun", action: "add", packages: ["react", "react-dom"], flags: [] });
});

test("parsePackageCommand: bun add with -D flag", () => {
  const r = parsePackageCommand("bun add -D typescript");
  expect(r).toEqual({ manager: "bun", action: "add", packages: ["typescript"], flags: ["-D"] });
});

test("parsePackageCommand: bun remove", () => {
  const r = parsePackageCommand("bun remove lodash");
  expect(r).toEqual({ manager: "bun", action: "remove", packages: ["lodash"], flags: [] });
});

test("parsePackageCommand: npm install", () => {
  const r = parsePackageCommand("npm install express");
  expect(r).toEqual({ manager: "npm", action: "install", packages: ["express"], flags: [] });
});

test("parsePackageCommand: npm i (shorthand)", () => {
  const r = parsePackageCommand("npm i express");
  expect(r).toEqual({ manager: "npm", action: "install", packages: ["express"], flags: [] });
});

test("parsePackageCommand: npm uninstall", () => {
  const r = parsePackageCommand("npm uninstall express");
  expect(r).toEqual({ manager: "npm", action: "remove", packages: ["express"], flags: [] });
});

test("parsePackageCommand: pip install", () => {
  const r = parsePackageCommand("pip install requests flask");
  expect(r).toEqual({ manager: "pip", action: "install", packages: ["requests", "flask"], flags: [] });
});

test("parsePackageCommand: pip3 install", () => {
  const r = parsePackageCommand("pip3 install numpy");
  expect(r).toEqual({ manager: "pip", action: "install", packages: ["numpy"], flags: [] });
});

test("parsePackageCommand: cargo add", () => {
  const r = parsePackageCommand("cargo add serde tokio");
  expect(r).toEqual({ manager: "cargo", action: "add", packages: ["serde", "tokio"], flags: [] });
});

test("parsePackageCommand: unsafe flags are filtered out", () => {
  const r = parsePackageCommand("npm install --registry=evil.com express");
  expect(r).toEqual({ manager: "npm", action: "install", packages: ["express"], flags: [] });
});

test("parsePackageCommand: safe flags are kept", () => {
  const r = parsePackageCommand("npm install --save-dev --exact typescript");
  expect(r).toEqual({ manager: "npm", action: "install", packages: ["typescript"], flags: ["--save-dev", "--exact"] });
});

test("parsePackageCommand: returns null for non-package command", () => {
  expect(parsePackageCommand("echo hello")).toBeNull();
  expect(parsePackageCommand("bun test")).toBeNull();
  expect(parsePackageCommand("npm run build")).toBeNull();
  expect(parsePackageCommand("git push")).toBeNull();
});

test("parsePackageCommand: returns null for bare install (no packages)", () => {
  expect(parsePackageCommand("npm install")).toBeNull();
  expect(parsePackageCommand("bun add")).toBeNull();
});

// --- buildCommand ---

test("buildCommand: bun add", () => {
  expect(buildCommand("bun", "add", ["react"])).toBe("bun add react");
});

test("buildCommand: npm install with flags", () => {
  expect(buildCommand("npm", "install", ["typescript"], ["-D"])).toBe("npm install -D typescript");
});

test("buildCommand: pip remove", () => {
  expect(buildCommand("pip", "remove", ["flask"])).toBe("pip uninstall flask");
});

test("buildCommand: cargo add", () => {
  expect(buildCommand("cargo", "add", ["serde", "tokio"])).toBe("cargo add serde tokio");
});

// --- Category hardening ---

test("packages category is always approve-each", () => {
  expect(getCategoryMode("packages")).toBe("approve-each");
});

test("setCategoryMode refuses to change packages mode", () => {
  setCategoryMode("packages", "allow-all");
  expect(getCategoryMode("packages")).toBe("approve-each");

  setCategoryMode("packages", "deny-all");
  expect(getCategoryMode("packages")).toBe("approve-each");
});

// --- submitPackageRequest + getPackageRequest ---

test("submitPackageRequest goes through queue", async () => {
  const pkgReq = await submitPackageRequest("bun", ["test-pkg"], "add", "testing");
  expect(pkgReq.status).toBe("pending");
  expect(pkgReq.manager).toBe("bun");
  expect(pkgReq.packages).toEqual(["test-pkg"]);

  const looked = getPackageRequest(pkgReq.id);
  expect(looked).toBeDefined();
  expect(looked!.id).toBe(pkgReq.id);
});

test("submitPackageRequest denied by rule", async () => {
  addRule("deny", "packages(npm install malware)");
  const pkgReq = await submitPackageRequest("npm", ["malware"], "install");
  expect(pkgReq.status).toBe("denied");
  removeRule("deny", "packages(npm install malware)");
});

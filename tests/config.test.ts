import { test, expect, beforeEach } from "bun:test";
import {
  loadConfig,
  getConfig,
  isEndpointAllowed,
  getCategoryMode,
  addAllowedEndpoint,
  removeAllowedEndpoint,
  setCategoryMode,
  applyConfigChange,
  getRules,
  addRule,
  removeRule,
} from "../src/config";

beforeEach(async () => {
  await loadConfig();
});

test("default config has api.anthropic.com allowed", () => {
  const config = getConfig();
  expect(config.allowedEndpoints).toContain("api.anthropic.com");
});

test("isEndpointAllowed matches exact host", () => {
  expect(isEndpointAllowed("api.anthropic.com")).toBe(true);
  expect(isEndpointAllowed("evil.com")).toBe(false);
});

test("isEndpointAllowed matches subdomains", () => {
  addAllowedEndpoint("example.com");
  expect(isEndpointAllowed("sub.example.com")).toBe(true);
  expect(isEndpointAllowed("example.com")).toBe(true);
  expect(isEndpointAllowed("notexample.com")).toBe(false);
});

test("getCategoryMode returns mode from config", () => {
  expect(getCategoryMode("network")).toBe("approve-each");
});

test("addAllowedEndpoint adds new entry", () => {
  const added = addAllowedEndpoint("newhost.com");
  expect(added).toBe(true);
  expect(isEndpointAllowed("newhost.com")).toBe(true);
});

test("addAllowedEndpoint returns false for duplicate", () => {
  addAllowedEndpoint("dup.com");
  expect(addAllowedEndpoint("dup.com")).toBe(false);
});

test("removeAllowedEndpoint removes entry", () => {
  addAllowedEndpoint("removeme.com");
  expect(removeAllowedEndpoint("removeme.com")).toBe(true);
  expect(isEndpointAllowed("removeme.com")).toBe(false);
});

test("removeAllowedEndpoint returns false for non-existent", () => {
  expect(removeAllowedEndpoint("nope.com")).toBe(false);
});

test("setCategoryMode changes the mode", () => {
  setCategoryMode("network", "allow-all");
  expect(getCategoryMode("network")).toBe("allow-all");
  // Reset
  setCategoryMode("network", "approve-each");
});

test("applyConfigChange updates nested value", () => {
  const result = applyConfigChange({
    path: "categories.network.mode",
    value: "deny-all",
    reason: "test",
  });
  expect(result).toBe(true);
  expect(getCategoryMode("network")).toBe("deny-all");
  // Reset
  setCategoryMode("network", "approve-each");
});

test("all six categories exist in default config", () => {
  const config = getConfig();
  expect(Object.keys(config.categories)).toEqual([
    "network",
    "filesystem",
    "git",
    "packages",
    "sandbox",
    "exec",
  ]);
});

test("config has rules structure", () => {
  const config = getConfig();
  expect(config.rules).toHaveProperty("allow");
  expect(config.rules).toHaveProperty("deny");
  expect(Array.isArray(config.rules.allow)).toBe(true);
  expect(Array.isArray(config.rules.deny)).toBe(true);
});

test("addRule adds valid rule", () => {
  expect(addRule("allow", "network(*.example.com)")).toBe(true);
  expect(getRules().allow).toContain("network(*.example.com)");
});

test("addRule rejects invalid rule", () => {
  expect(addRule("allow", "invalid(pattern)")).toBe(false);
});

test("addRule rejects duplicate", () => {
  addRule("deny", "exec(rm *)");
  expect(addRule("deny", "exec(rm *)")).toBe(false);
});

test("removeRule removes existing rule", () => {
  addRule("allow", "git(main)");
  expect(removeRule("allow", "git(main)")).toBe(true);
  expect(getRules().allow).not.toContain("git(main)");
});

test("removeRule returns false for non-existent", () => {
  expect(removeRule("allow", "network(nope)")).toBe(false);
});

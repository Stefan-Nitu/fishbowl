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

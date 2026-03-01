import { test, expect } from "bun:test";
import {
  parseRule,
  matchPattern,
  evaluateRules,
  generateRule,
} from "../src/rules";
import type { RuleSet, Category } from "../src/types";

// --- parseRule ---

test("parseRule parses category(pattern)", () => {
  // Arrange & Act
  const r = parseRule("network(*.example.com)");
  // Assert
  expect(r).toEqual({ category: "network", pattern: "*.example.com" });
});

test("parseRule parses bare category as wildcard", () => {
  const r = parseRule("network");
  expect(r).toEqual({ category: "network", pattern: "*" });
});

test("parseRule returns null for invalid category", () => {
  expect(parseRule("invalid(*.com)")).toBeNull();
});

test("parseRule returns null for empty pattern", () => {
  expect(parseRule("network()")).toBeNull();
});

test("parseRule handles exec(bun test)", () => {
  const r = parseRule("exec(bun test)");
  expect(r).toEqual({ category: "exec", pattern: "bun test" });
});

// --- matchPattern ---

test("matchPattern: * matches everything for non-filesystem", () => {
  expect(matchPattern("*", "anything", "exec")).toBe(true);
  expect(matchPattern("*", "hello.world", "network")).toBe(true);
});

test("matchPattern: hostname glob", () => {
  expect(matchPattern("*.example.com", "api.example.com", "network")).toBe(true);
  expect(matchPattern("*.example.com", "evil.com", "network")).toBe(false);
});

test("matchPattern: *.domain also matches bare domain", () => {
  expect(matchPattern("*.example.com", "example.com", "network")).toBe(true);
  expect(matchPattern("*.github.com", "github.com", "network")).toBe(true);
  expect(matchPattern("*.example.com", "notexample.com", "network")).toBe(false);
});

test("matchPattern: command glob with spaces and slashes", () => {
  // Arrange: * should match anything including / for non-filesystem
  expect(matchPattern("bun test *", "bun test src/", "exec")).toBe(true);
  expect(matchPattern("bun test *", "bun test src/foo/bar.ts", "exec")).toBe(true);
  expect(matchPattern("rm -rf *", "rm -rf /", "exec")).toBe(true);
});

test("matchPattern: exact command match", () => {
  expect(matchPattern("bun test", "bun test", "exec")).toBe(true);
  expect(matchPattern("bun test", "bun test src", "exec")).toBe(false);
});

test("matchPattern: filesystem uses Bun.Glob (path-aware)", () => {
  // * matches one segment only
  expect(matchPattern("src/*", "src/config.ts", "filesystem")).toBe(true);
  expect(matchPattern("src/*", "src/deep/nested.ts", "filesystem")).toBe(false);
  // ** matches recursive
  expect(matchPattern("src/**", "src/deep/nested.ts", "filesystem")).toBe(true);
});

test("matchPattern: .env glob", () => {
  expect(matchPattern(".env*", ".env", "filesystem")).toBe(true);
  expect(matchPattern(".env*", ".env.local", "filesystem")).toBe(true);
  expect(matchPattern(".env*", "src/config.ts", "filesystem")).toBe(false);
});

// --- evaluateRules ---

test("evaluateRules: deny rule blocks matching request", () => {
  // Arrange
  const rules: RuleSet = { allow: [], deny: ["exec(rm -rf *)"] };
  // Act & Assert
  expect(evaluateRules(rules, "exec", "rm -rf /")).toBe("deny");
});

test("evaluateRules: allow rule permits matching request", () => {
  const rules: RuleSet = { allow: ["exec(bun test *)"], deny: [] };
  expect(evaluateRules(rules, "exec", "bun test src/")).toBe("allow");
});

test("evaluateRules: deny beats allow when both match", () => {
  const rules: RuleSet = {
    allow: ["network(*.example.com)"],
    deny: ["network(evil.example.com)"],
  };
  expect(evaluateRules(rules, "network", "evil.example.com")).toBe("deny");
});

test("evaluateRules: returns null when no rules match", () => {
  const rules: RuleSet = { allow: ["network(*.known.com)"], deny: [] };
  expect(evaluateRules(rules, "network", "unknown.com")).toBeNull();
});

test("evaluateRules: bare exec allow rule is ignored (safety)", () => {
  const rules: RuleSet = { allow: ["exec"], deny: [] };
  expect(evaluateRules(rules, "exec", "anything")).toBeNull();
});

test("evaluateRules: bare packages allow rule is ignored (safety)", () => {
  const rules: RuleSet = { allow: ["packages"], deny: [] };
  expect(evaluateRules(rules, "packages", "npm install anything")).toBeNull();
});

test("evaluateRules: rule only matches its own category", () => {
  const rules: RuleSet = { allow: ["network(*.example.com)"], deny: [] };
  expect(evaluateRules(rules, "exec", "*.example.com")).toBeNull();
});

test("evaluateRules: filesystem deny on .env files", () => {
  const rules: RuleSet = { allow: [], deny: ["filesystem(.env*)"] };
  expect(evaluateRules(rules, "filesystem", ".env")).toBe("deny");
  expect(evaluateRules(rules, "filesystem", ".env.local")).toBe("deny");
  expect(evaluateRules(rules, "filesystem", "src/config.ts")).toBeNull();
});

test("evaluateRules: filesystem allow with recursive glob", () => {
  const rules: RuleSet = { allow: ["filesystem(src/**)"], deny: [] };
  expect(evaluateRules(rules, "filesystem", "src/foo/bar.ts")).toBe("allow");
  expect(evaluateRules(rules, "filesystem", "src/config.ts")).toBe("allow");
  expect(evaluateRules(rules, "filesystem", "lib/other.ts")).toBeNull();
});

// --- generateRule ---

test("generateRule: network extracts domain wildcard", () => {
  expect(generateRule("network", "CONNECT api.example.com:443")).toBe("network(*.example.com)");
});

test("generateRule: network with HTTP URL", () => {
  expect(generateRule("network", "GET https://api.example.com/data")).toBe("network(*.example.com)");
});

test("generateRule: network with IP uses exact match", () => {
  expect(generateRule("network", "CONNECT 192.168.1.1:443")).toBe("network(192.168.1.1)");
});

test("generateRule: exec keeps exact command", () => {
  expect(generateRule("exec", "bun test src/")).toBe("exec(bun test src/)");
});

test("generateRule: filesystem uses directory wildcard", () => {
  expect(generateRule("filesystem", "sync src/config.ts")).toBe("filesystem(src/*)");
});

test("generateRule: filesystem with no directory", () => {
  expect(generateRule("filesystem", "sync README.md")).toBe("filesystem(README.md)");
});

test("generateRule: git uses branch name", () => {
  expect(generateRule("git", "push feature/cool-thing")).toBe("git(feature/cool-thing)");
});

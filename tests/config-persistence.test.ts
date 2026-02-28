import { test, expect, afterEach } from "bun:test";
import { loadConfig, saveConfig, getConfig, addRule, removeRule, getRules, addAllowedEndpoint } from "../src/config";

const CONFIG_PATH = new URL("../sandbox.config.json", import.meta.url).pathname;
let savedContent: string;

// Save original config before tests, restore after each
afterEach(async () => {
  if (savedContent) {
    await Bun.write(CONFIG_PATH, savedContent);
    await loadConfig();
  }
});

test("rules survive save → load round-trip", async () => {
  savedContent = await Bun.file(CONFIG_PATH).text();
  await loadConfig();

  addRule("allow", "network(*.example.com)");
  addRule("deny", "exec(rm -rf *)");
  await saveConfig();

  // Reload from disk
  await loadConfig();
  const rules = getRules();

  expect(rules.allow).toContain("network(*.example.com)");
  expect(rules.deny).toContain("exec(rm -rf *)");
});

test("empty rules persist correctly", async () => {
  savedContent = await Bun.file(CONFIG_PATH).text();
  await loadConfig();

  // Ensure clean slate
  const rules = getRules();
  for (const r of [...rules.allow]) removeRule("allow", r);
  for (const r of [...rules.deny]) removeRule("deny", r);
  await saveConfig();

  await loadConfig();
  const reloaded = getRules();
  expect(reloaded.allow).toEqual([]);
  expect(reloaded.deny).toEqual([]);
});

test("multiple rules of same type persist", async () => {
  savedContent = await Bun.file(CONFIG_PATH).text();
  await loadConfig();

  addRule("allow", "network(*.github.com)");
  addRule("allow", "filesystem(src/**)");
  addRule("allow", "git(main)");
  await saveConfig();

  await loadConfig();
  const rules = getRules();
  expect(rules.allow).toContain("network(*.github.com)");
  expect(rules.allow).toContain("filesystem(src/**)");
  expect(rules.allow).toContain("git(main)");
});

test("allowedEndpoints persist through save/load", async () => {
  savedContent = await Bun.file(CONFIG_PATH).text();
  await loadConfig();

  addAllowedEndpoint("test-persist.example.com");
  await saveConfig();

  await loadConfig();
  const config = getConfig();
  expect(config.allowedEndpoints).toContain("test-persist.example.com");
});

test("category modes persist through save/load", async () => {
  savedContent = await Bun.file(CONFIG_PATH).text();
  await loadConfig();

  const config = getConfig();
  config.categories.network.mode = "allow-all";
  await saveConfig(config);

  await loadConfig();
  const reloaded = getConfig();
  expect(reloaded.categories.network.mode).toBe("allow-all");
});

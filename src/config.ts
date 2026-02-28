import type { SandboxConfig, Category, ApprovalMode, ConfigChangeProposal, RuleSet } from "./types";
import { DEFAULT_CONFIG } from "./types";
import { parseRule } from "./rules";

const CONFIG_PATH = new URL("../sandbox.config.json", import.meta.url).pathname;

let current: SandboxConfig = structuredClone(DEFAULT_CONFIG);

export async function loadConfig(): Promise<SandboxConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      current = await file.json();
      if (!current.rules) current.rules = { allow: [], deny: [] };
    }
  } catch {
    current = structuredClone(DEFAULT_CONFIG);
  }
  return current;
}

export async function saveConfig(config?: SandboxConfig): Promise<void> {
  if (config) current = config;
  await Bun.write(CONFIG_PATH, JSON.stringify(current, null, 2) + "\n");
}

export function getConfig(): SandboxConfig {
  return current;
}

export function isEndpointAllowed(host: string): boolean {
  return current.allowedEndpoints.some(
    (allowed) => host === allowed || host.endsWith("." + allowed)
  );
}

export function getCategoryMode(category: Category): ApprovalMode {
  // exec and packages categories are always approve-each, regardless of config
  if (category === "exec" || category === "packages") return "approve-each";
  return current.categories[category]?.mode ?? "approve-each";
}

export function applyConfigChange(proposal: ConfigChangeProposal): boolean {
  const parts = proposal.path.split(".");
  let target: any = current;

  for (let i = 0; i < parts.length - 1; i++) {
    target = target[parts[i]];
    if (target === undefined) return false;
  }

  const lastKey = parts[parts.length - 1];
  target[lastKey] = proposal.value;
  return true;
}

export function addAllowedEndpoint(endpoint: string): boolean {
  if (current.allowedEndpoints.includes(endpoint)) return false;
  current.allowedEndpoints.push(endpoint);
  return true;
}

export function removeAllowedEndpoint(endpoint: string): boolean {
  const idx = current.allowedEndpoints.indexOf(endpoint);
  if (idx === -1) return false;
  current.allowedEndpoints.splice(idx, 1);
  return true;
}

export function setCategoryMode(category: Category, mode: ApprovalMode): void {
  // exec and packages categories ALWAYS require approve-each — never allow override
  if ((category === "exec" || category === "packages") && mode !== "approve-each") return;
  current.categories[category] = { mode };
}

export function getRules(): RuleSet {
  return current.rules || { allow: [], deny: [] };
}

export function addRule(type: "allow" | "deny", rule: string): boolean {
  if (!current.rules) current.rules = { allow: [], deny: [] };
  const list = current.rules[type];
  if (list.includes(rule)) return false;
  if (!parseRule(rule)) return false;
  list.push(rule);
  return true;
}

export function removeRule(type: "allow" | "deny", rule: string): boolean {
  if (!current.rules) return false;
  const list = current.rules[type];
  const idx = list.indexOf(rule);
  if (idx === -1) return false;
  list.splice(idx, 1);
  return true;
}

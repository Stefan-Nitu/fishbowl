import type { Category, RuleSet } from "./types";

const VALID_CATEGORIES = new Set<string>([
  "network", "filesystem", "git", "packages", "sandbox", "exec",
]);

export interface ParsedRule {
  category: Category;
  pattern: string;
}

export function parseRule(rule: string): ParsedRule | null {
  const parenIdx = rule.indexOf("(");
  if (parenIdx === -1) {
    if (!VALID_CATEGORIES.has(rule)) return null;
    return { category: rule as Category, pattern: "*" };
  }

  const category = rule.slice(0, parenIdx);
  if (!VALID_CATEGORIES.has(category)) return null;

  let pattern = rule.slice(parenIdx + 1);
  if (pattern.endsWith(")")) pattern = pattern.slice(0, -1);
  if (!pattern) return null;

  return { category: category as Category, pattern };
}

/**
 * Match a pattern against a target string.
 * filesystem uses Bun.Glob (path-aware: * = one segment, ** = recursive).
 * Everything else uses glob-to-regex where * matches anything.
 */
export function matchPattern(
  pattern: string,
  target: string,
  category: Category,
): boolean {
  if (pattern === "*") return true;

  if (category === "filesystem") {
    return new Bun.Glob(pattern).match(target);
  }

  // Simple glob-to-regex: * matches anything (including / and spaces)
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp("^" + escaped.replace(/\*+/g, ".*") + "$");
  return regex.test(target);
}

export type RuleVerdict = "allow" | "deny" | null;

/**
 * Evaluate rules for a permission request.
 * Deny rules checked first — deny wins over allow.
 * Returns null if no rules match (fall through to category mode).
 */
export function evaluateRules(
  rules: RuleSet,
  category: Category,
  matchTarget: string,
): RuleVerdict {
  // 1. Check deny rules first
  for (const rule of rules.deny) {
    const parsed = parseRule(rule);
    if (!parsed || parsed.category !== category) continue;
    if (matchPattern(parsed.pattern, matchTarget, category)) return "deny";
  }

  // 2. Check allow rules
  for (const rule of rules.allow) {
    const parsed = parseRule(rule);
    if (!parsed || parsed.category !== category) continue;
    // Safety: bare exec/packages allow rule (match-all) is ignored
    if ((parsed.category === "exec" || parsed.category === "packages") && parsed.pattern === "*") continue;
    if (matchPattern(parsed.pattern, matchTarget, category)) return "allow";
  }

  return null;
}

export function extractNetworkHost(action: string): string | null {
  const connectMatch = action.match(/^CONNECT\s+([^:]+)/);
  if (connectMatch) return connectMatch[1];
  try {
    const urlMatch = action.match(/\bhttps?:\/\/([^/:\s]+)/);
    if (urlMatch) return urlMatch[1];
  } catch {}
  // Fallback: try "METHOD host/path" pattern
  const methodMatch = action.match(/^\w+\s+(\S+)/);
  if (methodMatch) {
    try {
      const url = new URL(methodMatch[1]);
      return url.hostname;
    } catch {}
  }
  return null;
}

/**
 * Generate a rule pattern from a permission request's action string.
 */
export function generateRule(category: Category, action: string): string {
  switch (category) {
    case "network": {
      const host = extractNetworkHost(action);
      if (host) {
        if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return `network(${host})`;
        const parts = host.split(".");
        if (parts.length >= 2) {
          const domain = parts.slice(-2).join(".");
          return `network(*.${domain})`;
        }
        return `network(${host})`;
      }
      return `network(${action})`;
    }
    case "exec":
      return `exec(${action})`;
    case "filesystem": {
      const path = action.replace(/^sync\s+/, "");
      const dir = path.substring(0, path.lastIndexOf("/") + 1);
      if (dir) return `filesystem(${dir}*)`;
      return `filesystem(${path})`;
    }
    case "git": {
      const branch = action.replace(/^push\s+/, "");
      return `git(${branch})`;
    }
    case "packages":
      return `packages(${action})`;
    case "sandbox":
      return `sandbox(${action})`;
  }
}

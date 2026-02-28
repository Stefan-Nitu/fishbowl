import { queue } from "./queue";
import { getRules } from "./config";
import { evaluateRules } from "./rules";

const DEFAULT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

// Flags that are safe to pass through (no side effects beyond install)
const SAFE_FLAGS = new Set([
  "-D", "--dev", "--save-dev",
  "-E", "--exact",
  "-g", "--global",
  "--save", "--save-exact",
]);

export interface PackageResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface PackageRequest {
  id: string;
  manager: string;
  packages: string[];
  action: "install" | "add" | "remove";
  cwd?: string;
  reason?: string;
  timeout: number;
  status: "pending" | "approved" | "denied" | "running" | "completed" | "failed";
  result?: PackageResult;
  createdAt: number;
  completedAt?: number;
}

interface ParsedPackageCommand {
  manager: string;
  action: "install" | "add" | "remove";
  packages: string[];
  flags: string[];
}

const packageRequests = new Map<string, PackageRequest>();

/**
 * Detect bun add / npm install / pip install / cargo add patterns.
 * Returns null if the command is not a package install command.
 */
export function parsePackageCommand(command: string): ParsedPackageCommand | null {
  const parts = command.trim().split(/\s+/);
  if (parts.length < 2) return null;

  const bin = parts[0];
  const sub = parts[1];
  const rest = parts.slice(2);

  // bun add / bun remove
  if (bin === "bun" && (sub === "add" || sub === "remove")) {
    const { packages, flags } = splitArgs(rest);
    if (packages.length === 0) return null;
    return { manager: "bun", action: sub === "remove" ? "remove" : "add", packages, flags };
  }

  // npm install / npm uninstall
  if (bin === "npm" && (sub === "install" || sub === "i" || sub === "uninstall")) {
    const { packages, flags } = splitArgs(rest);
    if (packages.length === 0) return null;
    const action = sub === "uninstall" ? "remove" : "install";
    return { manager: "npm", action, packages, flags };
  }

  // pip install / pip uninstall
  if ((bin === "pip" || bin === "pip3") && (sub === "install" || sub === "uninstall")) {
    const { packages, flags } = splitArgs(rest);
    if (packages.length === 0) return null;
    const action = sub === "uninstall" ? "remove" : "install";
    return { manager: "pip", action, packages, flags };
  }

  // cargo add / cargo remove
  if (bin === "cargo" && (sub === "add" || sub === "remove")) {
    const { packages, flags } = splitArgs(rest);
    if (packages.length === 0) return null;
    return { manager: "cargo", action: sub === "remove" ? "remove" : "add", packages, flags };
  }

  return null;
}

function splitArgs(args: string[]): { packages: string[]; flags: string[] } {
  const packages: string[] = [];
  const flags: string[] = [];
  for (const arg of args) {
    if (arg.startsWith("-")) {
      if (SAFE_FLAGS.has(arg)) flags.push(arg);
      // Unsafe flags are silently dropped
    } else {
      packages.push(arg);
    }
  }
  return { packages, flags };
}

export function getPackageRequest(id: string): PackageRequest | undefined {
  return packageRequests.get(id);
}

export function buildCommand(manager: string, action: string, packages: string[], flags: string[] = []): string {
  const parts = [manager];
  switch (manager) {
    case "bun": parts.push(action === "remove" ? "remove" : "add"); break;
    case "npm": parts.push(action === "remove" ? "uninstall" : "install"); break;
    case "pip":
    case "pip3": parts.push(action === "remove" ? "uninstall" : "install"); break;
    case "cargo": parts.push(action === "remove" ? "remove" : "add"); break;
    default: parts.push(action); break;
  }
  parts.push(...flags, ...packages);
  return parts.join(" ");
}

async function runPackageCommand(command: string, cwd?: string, timeout?: number): Promise<PackageResult> {
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd: cwd || undefined,
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeout ?? DEFAULT_TIMEOUT);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  clearTimeout(timer);

  if (timedOut) {
    return { stdout, stderr: stderr + "\n[timed out]", exitCode: 124 };
  }

  return { stdout, stderr, exitCode };
}

/**
 * Submit a package install/add/remove request. Goes through the permission
 * queue with mandatory approve-each mode — no overrides.
 */
export async function submitPackageRequest(
  manager: string,
  packages: string[],
  action: "install" | "add" | "remove",
  reason?: string,
  cwd?: string,
  timeout?: number,
): Promise<PackageRequest> {
  const timeoutMs = timeout ?? DEFAULT_TIMEOUT;
  const matchTarget = `${manager} ${action} ${packages.join(" ")}`;

  const verdict = evaluateRules(getRules(), "packages", matchTarget);
  if (verdict === "deny") {
    const pkgReq: PackageRequest = {
      id: `pkg-denied-${Date.now()}`,
      manager, packages, action, cwd, reason, timeout: timeoutMs,
      status: "denied", createdAt: Date.now(), completedAt: Date.now(),
    };
    packageRequests.set(pkgReq.id, pkgReq);
    return pkgReq;
  }
  if (verdict === "allow") {
    const id = `pkg-auto-${Date.now()}`;
    const pkgReq: PackageRequest = {
      id, manager, packages, action, cwd, reason, timeout: timeoutMs,
      status: "running", createdAt: Date.now(),
    };
    packageRequests.set(id, pkgReq);
    const command = buildCommand(manager, action, packages);
    try {
      pkgReq.result = await runPackageCommand(command, cwd, timeoutMs);
      pkgReq.status = "completed";
    } catch (err) {
      pkgReq.result = { stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: -1 };
      pkgReq.status = "failed";
    }
    pkgReq.completedAt = Date.now();
    return pkgReq;
  }

  const command = buildCommand(manager, action, packages);
  const { id, promise } = queue.request(
    "packages",
    matchTarget,
    `Package ${action}: ${manager} ${packages.join(", ")}`,
    reason,
    { manager, packages, action, cwd, timeout: timeoutMs },
  );

  const pkgReq: PackageRequest = {
    id, manager, packages, action, cwd, reason, timeout: timeoutMs,
    status: "pending", createdAt: Date.now(),
  };
  packageRequests.set(id, pkgReq);

  promise.then(async (approved) => {
    if (!approved) {
      pkgReq.status = "denied";
      pkgReq.completedAt = Date.now();
      return;
    }

    pkgReq.status = "running";
    try {
      pkgReq.result = await runPackageCommand(command, cwd, timeoutMs);
      pkgReq.status = "completed";
    } catch (err) {
      pkgReq.result = {
        stdout: "",
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: -1,
      };
      pkgReq.status = "failed";
    }
    pkgReq.completedAt = Date.now();
  });

  return pkgReq;
}

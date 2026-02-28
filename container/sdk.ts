/**
 * Lightweight client SDK for agents running inside the sandbox.
 * Communicates with the permission server via SANDBOX_API env var.
 *
 * Usage:
 *   import { sandbox } from "./sdk";
 *   const approved = await sandbox.requestPermission("network", "fetch https://example.com", "Need to download data");
 */

const API = process.env.SANDBOX_API || "http://localhost:3700";

export type Category = "network" | "filesystem" | "git" | "packages" | "sandbox" | "exec";

interface PermissionResponse {
  id: string;
}

interface QueueItem {
  id: string;
  status: "pending" | "approved" | "denied";
  category: string;
  action: string;
}

async function requestPermission(
  category: Category,
  action: string,
  reason?: string,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  const res = await fetch(`${API}/api/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category,
      action,
      description: action,
      reason,
      metadata,
    }),
  });

  const { id } = (await res.json()) as PermissionResponse;

  // Poll until resolved
  while (true) {
    await Bun.sleep(500);
    const poll = await fetch(`${API}/api/queue`);
    const { pending, recent } = (await poll.json()) as {
      pending: QueueItem[];
      recent: QueueItem[];
    };

    const item = [...pending, ...recent].find((r) => r.id === id);
    if (!item || item.status === "pending") continue;
    return item.status === "approved";
  }
}

async function proposeConfigChange(
  path: string,
  value: unknown,
  reason: string
): Promise<boolean> {
  const res = await fetch(`${API}/api/config/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, value, reason }),
  });

  const { id } = (await res.json()) as PermissionResponse;

  while (true) {
    await Bun.sleep(500);
    const poll = await fetch(`${API}/api/queue`);
    const { pending, recent } = (await poll.json()) as {
      pending: QueueItem[];
      recent: QueueItem[];
    };

    const item = [...pending, ...recent].find((r) => r.id === id);
    if (!item || item.status === "pending") continue;
    return item.status === "approved";
  }
}

async function listPending(): Promise<QueueItem[]> {
  const res = await fetch(`${API}/api/queue`);
  const { pending } = (await res.json()) as { pending: QueueItem[] };
  return pending;
}

async function getConfig(): Promise<Record<string, unknown>> {
  const res = await fetch(`${API}/api/config`);
  return res.json();
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ExecResponse {
  id: string;
  status: "pending" | "approved" | "denied" | "running" | "completed" | "failed";
  result?: ExecResult;
}

async function requestExec(
  command: string,
  reason?: string,
  cwd?: string
): Promise<ExecResult> {
  const res = await fetch(`${API}/api/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, reason, cwd }),
  });

  const { id } = (await res.json()) as { id: string };

  // Poll until completed
  while (true) {
    await Bun.sleep(500);
    const poll = await fetch(`${API}/api/exec/${id}`);
    const data = (await poll.json()) as ExecResponse;

    if (data.status === "denied") {
      throw new Error(`Exec request denied: ${command}`);
    }
    if (data.status === "completed" || data.status === "failed") {
      return data.result!;
    }
  }
}

interface PackageResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface PackageResponse {
  id: string;
  status: "pending" | "approved" | "denied" | "running" | "completed" | "failed";
  result?: PackageResult;
}

async function requestPackageInstall(
  manager: string,
  packages: string[],
  reason?: string,
): Promise<PackageResult> {
  const res = await fetch(`${API}/api/packages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ manager, packages, action: "install", reason }),
  });

  const { id } = (await res.json()) as { id: string };

  // Poll until completed
  while (true) {
    await Bun.sleep(500);
    const poll = await fetch(`${API}/api/packages/${id}`);
    const data = (await poll.json()) as PackageResponse;

    if (data.status === "denied") {
      throw new Error(`Package install denied: ${manager} ${packages.join(" ")}`);
    }
    if (data.status === "completed" || data.status === "failed") {
      return data.result!;
    }
  }
}

export const sandbox = {
  requestPermission,
  proposeConfigChange,
  listPending,
  getConfig,
  requestExec,
  requestPackageInstall,
};

export default sandbox;
